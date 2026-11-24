import { createHash } from "node:crypto";
import { getPool } from "./db";
import { stripeClient, stripeEnvironment } from "./billing";
import { ApiError, integer, string, uuid } from "./server";
import { sandboxAccepted } from "./launch-controls";
import { validateCatalog, currentCatalog } from "./billing-catalog";
import { saveSubscription } from "./subscription-management";
import {
  couponDefinitionMatches,
  insertLocalCoupon,
  listBillingCoupons,
  parseCouponInput,
  productsForTargets,
  setPromotionActive,
  syncCouponToStripe,
  type CatalogTarget,
} from "./billing-coupons";
import {
  listBillingAddons,
  syncAddonToStripe,
  syncAllAddonsToStripe,
  updateBillingAddon,
} from "./billing-addons";

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const fingerprint = (s: any) =>
  hash({
    id: s.id,
    status: s.status,
    items: s.items.data.map((i: any) => [i.id, i.price.id, i.quantity]),
    pending: s.pending_update,
    cancel: s.cancel_at_period_end,
    schedule: s.schedule,
    discounts: s.discounts,
    taxes: s.default_tax_rates,
    automaticTax: s.automatic_tax,
    latestInvoice: s.latest_invoice,
  });

export async function adminBilling(actor: string, input: Record<string, unknown>) {
  const operation = uuid(input.operationId),
    action = String(input.action),
    reason = string(input.reason, "reason", 500, 5);
  const payload = hash(input),
    pool = getPool(),
    db = await pool.connect();
  let committed = false;
  try {
    await db.query(
      "INSERT INTO private.billing_admin_operations(id,actor_id,action,payload_hash,state) VALUES($1,$2,$3,$4,'pending') ON CONFLICT DO NOTHING",
      [operation, actor, action, payload],
    );
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "admin-billing:" + operation,
    ]);
    const prior = (
      await db.query("SELECT * FROM private.billing_admin_operations WHERE id=$1 FOR UPDATE", [
        operation,
      ])
    ).rows[0];
    if (prior.actor_id !== actor || prior.payload_hash !== payload)
      throw new ApiError("This operation identifier was already used for another request.", 409);
    if (prior.state === "succeeded") {
      await db.query("COMMIT");
      committed = true;
      return prior.result;
    }
    let result: any = { ok: true };
    if (action === "draft") {
      const catalog = validateCatalog(input.catalog);
      result.id = (
        await db.query(
          "INSERT INTO private.billing_catalog_versions(state,catalog,created_by) VALUES('draft',$1,$2) RETURNING id",
          [JSON.stringify(catalog), actor],
        )
      ).rows[0].id;
    } else if (action === "list-coupons") {
      result = { ok: true, coupons: await listBillingCoupons(db) };
    } else if (action === "list-addons") {
      result = { ok: true, addons: await listBillingAddons(db) };
    } else if (action === "addon-update") {
      // Local catalog edit only — does not call Stripe or enable purchase flags.
      result = { ok: true, addon: await updateBillingAddon(db, actor, input) };
    } else if (action === "stripe-reconcile") {
      // Read-only comparison: safe without a catalog mutation gate.
      const stripe = await stripeClient();
      const environment = typeof stripeEnvironment === "function" ? await stripeEnvironment() : "unknown";
      const { reconcileStripeCatalog } = await import("./billing-reconcile");
      result = { ok: true, reconciliation: await reconcileStripeCatalog(stripe, environment, actor) };
    } else {
      if (!(await sandboxAccepted()))
        throw new ApiError(
          "Stripe sandbox lifecycle acceptance is required before billing mutations.",
          409,
        );
      const stripe = await stripeClient();
      if (action === "addon-sync") {
        const addonId = string(input.addonId || input.id, "add-on id", 64, 1);
        const environment =
          typeof stripeEnvironment === "function" ? await stripeEnvironment() : "unknown";
        try {
          const synced = await syncAddonToStripe(db, stripe, addonId, actor, environment);
          if (synced.sync_status !== "synced" || !synced.stripe_price_id) {
            throw new ApiError(
              "Stripe add-on price was not created. Retry sync after fixing the provider error.",
              503,
            );
          }
          result = {
            ok: true,
            addonId: synced.id,
            product: synced.stripe_product_id,
            price: synced.stripe_price_id,
            syncStatus: synced.sync_status,
          };
        } catch (syncError) {
          // Commit failed sync_status + audit (like coupons) so outer rollback cannot erase them.
          await db.query(
            "UPDATE private.billing_admin_operations SET state='failed',error=$2,result=$3,updated_at=now() WHERE id=$1",
            [
              operation,
              syncError instanceof ApiError
                ? syncError.message
                : "Stripe add-on synchronization failed.",
              JSON.stringify({ addonId, syncStatus: "failed" }),
            ],
          );
          await db.query("COMMIT");
          committed = true;
          throw syncError instanceof ApiError
            ? syncError
            : new ApiError(
                "Stripe add-on synchronization failed. The add-on was saved locally as failed — use Sync again.",
                503,
              );
        }
      } else if (action === "addon-sync-all") {
        if (input.confirmStripeSync !== true) {
          throw new ApiError(
            "Confirm Stripe sync to create or refresh add-on products and prices in the connected Stripe account.",
            400,
          );
        }
        const environment =
          typeof stripeEnvironment === "function" ? await stripeEnvironment() : "unknown";
        const results = await syncAllAddonsToStripe(db, stripe, actor, environment);
        result = {
          ok: true,
          results,
          message: "Add-on Stripe sync finished. Purchase remains gated until ADDON_BILLING_VALIDATED.",
        };
      } else if (action === "publish") {
        if (input.confirmLiveStripe !== true)
          throw new ApiError(
            "Confirm publishing to create new Stripe prices for new enrollments. Existing subscriber prices are never rewritten.",
            400,
          );
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended('subscription-catalog-v1',0))");
        const id = uuid(input.draftId),
          draft = (
            await db.query(
              "SELECT * FROM private.billing_catalog_versions WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0];
        if (!draft || draft.state !== "draft") throw new ApiError("Choose an unpublished draft.", 409);
        const catalog = validateCatalog(draft.catalog),
          version = "release-" + id;
        for (const offer of catalog.offers) {
          const price = await stripe.prices.create(
            {
              product: "zenvio_" + offer.id + "_v3",
              currency: "usd",
              unit_amount: offer.monthly,
              recurring: { interval: "month" },
              metadata: { zenvio_offer: offer.id, catalog_version: version },
            },
            { idempotencyKey: "catalog-" + id + "-" + offer.id },
          );
          await db.query(
            "INSERT INTO private.subscription_prices(plan,period,stripe_price_id,catalog_version) VALUES($1,'monthly',$2,$3) ON CONFLICT(plan,period) DO UPDATE SET stripe_price_id=$2,catalog_version=$3",
            [offer.id, price.id, version],
          );
          await db.query(
            "INSERT INTO private.subscription_price_history(stripe_price_id,plan,period,catalog_version) VALUES($1,$2,'monthly',$3) ON CONFLICT DO NOTHING",
            [price.id, offer.id, version],
          );
        }
        await db.query(
          "UPDATE private.billing_catalog_versions SET state='superseded' WHERE state='published'",
        );
        await db.query(
          "UPDATE private.billing_catalog_versions SET state='published',published_at=now() WHERE id=$1",
          [id],
        );
        result = {
          ok: true,
          version,
          message: "Published for new enrollments. Existing subscriptions are unchanged.",
        };
      } else if (action === "coupon" || action === "coupon-retry") {
        // Persist local coupon even when Stripe sync fails so admins can retry.
        // Success is only returned after both Stripe coupon + promotion code exist.
        let couponId: string;
        if (action === "coupon") {
          const legacyCompat =
            input.discountType == null &&
            input.percent != null &&
            (input.months != null || input.durationInMonths != null);
          const parsed = parseCouponInput(
            legacyCompat
              ? {
                  ...input,
                  discountType: "percent",
                  duration: "repeating",
                  durationInMonths: input.months ?? input.durationInMonths,
                  catalogTargets: (input.catalogTargets as CatalogTarget[]) || ["v3"],
                }
              : input,
          );
          const products = productsForTargets(parsed.catalogTargets || ["v3"]);
          // Reuse coupon from a prior failed attempt of this operation, or an existing code row
          // whose normalized definition matches (targets/duration/eligibility). Else 409.
          // Same-op reuse (failed or pending durable associate) keeps couponId on the operation.
          const priorCouponId =
            prior.result && typeof prior.result === "object"
              ? (prior.result as { couponId?: string }).couponId
              : null;
          if (priorCouponId) {
            couponId = String(priorCouponId);
          } else {
            const existing = (
              await db.query(
                "SELECT * FROM private.billing_coupons WHERE lower(code)=lower($1) LIMIT 1",
                [parsed.code],
              )
            ).rows[0];
            if (existing?.id) {
              if (!couponDefinitionMatches(existing, parsed, products)) {
                throw new ApiError(
                  "A coupon with this code already exists with a different discount, duration, catalog target, or eligibility.",
                  409,
                );
              }
              couponId = existing.id;
            } else {
              // Insert on the pool so coupon identity survives outer rollback (operation_log failure).
              const local = await insertLocalCoupon(pool, actor, parsed, products);
              couponId = local.id;
            }
          }
          // Durable op↔coupon association before Stripe so idempotency keys stay stable across retries.
          await pool.query(
            `UPDATE private.billing_admin_operations
                SET result=$2,updated_at=now()
              WHERE id=$1 AND state<>'succeeded'`,
            [operation, JSON.stringify({ couponId, syncStatus: "pending" })],
          );
          if (prior.result == null || typeof prior.result !== "object") {
            prior.result = { couponId, syncStatus: "pending" };
          } else {
            Object.assign(prior.result as object, { couponId, syncStatus: "pending" });
          }
        } else {
          couponId = uuid(input.couponId);
        }
        try {
          const synced = await syncCouponToStripe(db, stripe, couponId, actor, operation);
          if (synced.sync_status !== "synced" || !synced.stripe_promotion_code_id) {
            throw new ApiError(
              "Stripe promotion code was not created. The coupon is marked failed — use Retry sync after fixing the provider error.",
              503,
            );
          }
          result = {
            ok: true,
            couponId: synced.id,
            coupon: synced.stripe_coupon_id,
            promotion: synced.stripe_promotion_code_id,
            code: synced.code,
            syncStatus: synced.sync_status,
          };
        } catch (syncError) {
          // Commit durable failed coupon row (with couponId for reuse), then surface the error.
          await db.query(
            "UPDATE private.billing_admin_operations SET state='failed',error=$2,result=$3,updated_at=now() WHERE id=$1",
            [
              operation,
              syncError instanceof ApiError
                ? syncError.message
                : "Stripe coupon synchronization failed.",
              JSON.stringify({ couponId, syncStatus: "failed" }),
            ],
          );
          await db.query("COMMIT");
          committed = true;
          throw syncError instanceof ApiError
            ? syncError
            : new ApiError(
                "Stripe coupon synchronization failed. The coupon was saved locally as failed — use Retry sync.",
                503,
              );
        }
      } else if (action === "promotion-status") {
        // Prefer durable coupon id; fall back to legacy promotion id lookup.
        if (input.couponId) {
          const updated = await setPromotionActive(
            db,
            stripe,
            uuid(input.couponId),
            input.active === true,
            actor,
            operation,
          );
          result = {
            ok: true,
            couponId: updated.id,
            promotion: updated.stripe_promotion_code_id,
            active: updated.active,
            syncStatus: updated.sync_status,
          };
        } else {
          const id = string(input.promotionId, "promotion identifier", 100);
          const promo = await stripe.promotionCodes.retrieve(id);
          const couponId =
            typeof promo.promotion.coupon === "string"
              ? promo.promotion.coupon
              : promo.promotion.coupon?.id;
          if (!couponId) throw new ApiError("Promotion ownership could not be verified.", 409);
          const managed = (
            await db.query(
              `SELECT id FROM private.billing_coupons WHERE stripe_promotion_code_id=$1
               UNION
               SELECT NULL::uuid WHERE EXISTS(
                 SELECT 1 FROM private.billing_admin_operations
                  WHERE action='coupon' AND state='succeeded' AND result->>'promotion'=$1
               )`,
              [id],
            )
          ).rows[0];
          if (!managed) throw new ApiError("Only platform-created promotions can be managed here.", 403);
          if (typeof input.active !== "boolean") throw new ApiError("Choose a promotion status.");
          if (managed.id) {
            const updated = await setPromotionActive(
              db,
              stripe,
              managed.id,
              input.active,
              actor,
              operation,
            );
            result = {
              ok: true,
              couponId: updated.id,
              promotion: updated.stripe_promotion_code_id,
              active: updated.active,
              syncStatus: updated.sync_status,
            };
          } else {
            await stripe.promotionCodes.update(
              id,
              { active: input.active },
              { idempotencyKey: operation },
            );
            const live = await stripe.promotionCodes.retrieve(id);
            if (live.active !== input.active) {
              throw new ApiError(
                "This promotion status change was superseded by a newer pause/resume. Refresh and try again.",
                409,
              );
            }
            result = {
              ok: true,
              promotion: id,
              active: live.active === true,
              syncStatus: live.active ? "synced" : "disabled",
            };
          }
        }
      } else if (action === "preview" || action === "change") {
        const user = uuid(input.userId);
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["billing:" + user]);
        const local = (
          await db.query("SELECT * FROM private.subscriptions WHERE user_id=$1 FOR UPDATE", [user])
        ).rows[0];
        if (!local?.subscription_id)
          throw new ApiError(
            "This customer has no recurring subscription. Use a customer-approved checkout.",
            409,
          );
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "subscription:" + local.subscription_id,
        ]);
        const current = await stripe.subscriptions.retrieve(local.subscription_id, {
          expand: ["discounts"],
        });
        const customer =
          typeof current.customer === "string" ? current.customer : current.customer.id;
        if (customer !== local.customer_id || current.metadata.user_id !== user)
          throw new ApiError("Subscription ownership could not be verified.", 409);
        const dispatch =
          action === "change"
            ? (
                await db.query(
                  "SELECT * FROM private.billing_change_dispatches WHERE operation_id=$1",
                  [operation],
                )
              ).rows[0]
            : null;
        if (
          !dispatch &&
          (!["active", "trialing"].includes(current.status) ||
            current.pending_update ||
            current.schedule ||
            current.cancel_at_period_end)
        )
          throw new ApiError("Resolve the subscription's current or scheduled billing state first.", 409);
        if (action === "preview") {
          const plan = String(input.plan);
          if (!["individual", "team"].includes(plan))
            throw new ApiError("Choose Individual or Teams.");
          const seats = plan === "team" ? integer(input.seats, "seats", 3, 1000) : 1;
          const members = (
            await db.query(
              "SELECT count(DISTINCT m.user_id)::int n FROM private.memberships m JOIN private.organizations o ON o.id=m.organization_id WHERE o.owner_id=$1 AND m.active",
              [user],
            )
          ).rows[0].n;
          if (members > seats)
            throw new ApiError("Deactivate or reassign teammates before reducing seats.", 409);
          const catalog = await currentCatalog(),
            lines: { price: string; quantity: number }[] = [];
          for (const [name, quantity] of [
            [plan, 1],
            ...(plan === "team" && seats > 3 ? [["team_extra", seats - 3]] : []),
          ] as [string, number][]) {
            const map = (
              await db.query(
                "SELECT stripe_price_id,catalog_version FROM private.subscription_prices WHERE plan=$1 AND period='monthly'",
                [name],
              )
            ).rows[0];
            const offer = catalog.offers.find((o) => o.id === name);
            if (!map || map.catalog_version !== catalog.version || !offer)
              throw new ApiError("Published price mapping is unavailable.", 409);
            const price = await stripe.prices.retrieve(map.stripe_price_id);
            if (
              price.product !== "zenvio_" + name + "_v3" ||
              price.currency !== "usd" ||
              !price.active ||
              price.unit_amount !== offer.monthly ||
              price.recurring?.interval !== "month" ||
              price.recurring.interval_count !== 1
            )
              throw new ApiError("Price verification failed.", 409);
            lines.push({ price: price.id, quantity });
          }
          const items = [
            ...current.items.data
              .filter((i) => !lines.some((l) => l.price === i.price.id))
              .map((i) => ({ id: i.id, deleted: true as const })),
            ...lines.map((l) => ({
              ...l,
              ...(current.items.data.find((i) => i.price.id === l.price)
                ? { id: current.items.data.find((i) => i.price.id === l.price)!.id }
                : {}),
            })),
          ];
          const prorationDate = Math.floor(Date.now() / 1000),
            preview = await stripe.invoices.createPreview({
              customer,
              subscription: current.id,
              subscription_details: { items, proration_date: prorationDate },
            });
          result = {
            ok: true,
            userId: user,
            subscription: current.id,
            fingerprint: fingerprint(current),
            items,
            seats,
            plan,
            prorationDate,
            amountDue: preview.amount_due,
            currency: preview.currency,
            expiresAt: Date.now() + 300000,
          };
        } else if (dispatch) {
          if (
            dispatch.actor_id !== actor ||
            dispatch.user_id !== user ||
            dispatch.subscription_id !== current.id ||
            Date.now() - new Date(dispatch.created_at).getTime() > 23 * 3600000
          )
            throw new ApiError(
              "This attempted change requires manual Stripe reconciliation before retry.",
              409,
            );
          const targetSeats = Number(
            (dispatch.request as { targetSeats?: number } | null)?.targetSeats,
          );
          if (Number.isInteger(targetSeats) && targetSeats > 0) {
            await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
              "entitlements:" + user,
            ]);
            const occupied =
              (
                await db.query(
                  "SELECT count(DISTINCT m.user_id)::int n FROM private.memberships m JOIN private.organizations o ON o.id=m.organization_id WHERE o.owner_id=$1 AND m.active",
                  [user],
                )
              ).rows[0]?.n || 0;
            if (occupied > targetSeats) {
              throw new ApiError(
                "Team membership changed while this seat reduction was pending. Preview again before reducing seats.",
                409,
              );
            }
          }
          const dispatchRequest = { ...(dispatch.request as Record<string, unknown>) };
          delete dispatchRequest.targetSeats;
          await stripe.subscriptions.update(current.id, dispatchRequest as never, {
            idempotencyKey: operation,
          });
          await saveSubscription(
            db,
            await stripe.subscriptions.retrieve(current.id, { expand: ["discounts"] }),
            user,
          );
          result = {
            ok: true,
            message: "Previously attempted Stripe change reconciled without another charge.",
          };
        } else {
          const preview = (
            await db.query(
              "SELECT result,actor_id FROM private.billing_admin_operations WHERE id=$1 AND action='preview' AND state='succeeded'",
              [uuid(input.previewId)],
            )
          ).rows[0];
          const p = preview?.result;
          if (
            !p ||
            preview.actor_id !== actor ||
            p.userId !== user ||
            p.subscription !== current.id ||
            p.expiresAt < Date.now() ||
            p.fingerprint !== fingerprint(current) ||
            input.confirm !== true ||
            input.amountDue !== p.amountDue
          )
            throw new ApiError(
              "The preview expired or changed. Preview and confirm the current amount again.",
              409,
            );
          await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
            "entitlements:" + user,
          ]);
          const occupied =
            (
              await db.query(
                "SELECT count(DISTINCT m.user_id)::int n FROM private.memberships m JOIN private.organizations o ON o.id=m.organization_id WHERE o.owner_id=$1 AND m.active",
                [user],
              )
            ).rows[0]?.n || 0;
          if (occupied > p.seats)
            throw new ApiError("Team membership changed. Preview again before reducing seats.", 409);
          const request = {
            items: p.items,
            payment_behavior: "pending_if_incomplete" as const,
            proration_behavior: "always_invoice" as const,
            proration_date: p.prorationDate,
            targetSeats: p.seats,
          };
          await pool.query(
            "INSERT INTO private.billing_change_dispatches(operation_id,actor_id,user_id,subscription_id,request) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
            [operation, actor, user, current.id, JSON.stringify(request)],
          );
          const { targetSeats: _ignoredTargetSeats, ...stripeChange } = request;
          const updated = await stripe.subscriptions.update(current.id, stripeChange as never, {
            idempotencyKey: operation,
          });
          await saveSubscription(db, updated, user);
          result = {
            ok: true,
            message: updated.pending_update
              ? "Payment is required before the change takes effect."
              : "Subscription updated; Stripe webhooks will reconcile subsequent changes.",
          };
        }
      } else throw new ApiError("Unknown billing action.");
    }
    await db.query(
      "UPDATE private.billing_admin_operations SET state='succeeded',result=$2,error=NULL,updated_at=now() WHERE id=$1",
      [operation, JSON.stringify(result)],
    );
    await db.query(
      "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'admin_billing_'||$2,$3)",
      [actor, action, JSON.stringify({ operation, reason, userId: input.userId || null, result })],
    );
    await db.query("COMMIT");
    committed = true;
    return result;
  } catch (e) {
    if (!committed) {
      try {
        await db.query("ROLLBACK");
      } catch {
        /* transaction may already be closed */
      }
      await db.query(
        "UPDATE private.billing_admin_operations SET state='failed',error=$2,updated_at=now() WHERE id=$1 AND actor_id=$3 AND payload_hash=$4 AND state<>'succeeded'",
        [
          operation,
          e instanceof ApiError
            ? e.message
            : "Provider synchronization failed; retry the same operation identifier.",
          actor,
          payload,
        ],
      );
    }
    throw e instanceof ApiError
      ? e
      : new ApiError(
          "Billing synchronization failed. No successful local change was committed. Retry the same operation identifier.",
          503,
        );
  } finally {
    db.release();
  }
}
