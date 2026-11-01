// Authoritative approved USD catalog. Historical subscriptions keep their own version.
export const catalogVersion = '2026-11-v3';
export const launchCouponId = 'zenvio_launch50_base_3months_v3';
export const launchProducts = ['zenvio_individual_v3','zenvio_team_v3'];
export const monthlyAllowances = Object.freeze({
 individual: Object.freeze({ emails:500, aiCredits:150, envelopes:10, videoMinutes:120, storageBytes:2000000000 }),
 team: Object.freeze({ emails:1500, aiCredits:450, envelopes:30, videoMinutes:360, storageBytes:10000000000 }),
});
// One credit covers at most $0.01 of estimated provider cost. Round up per execution.
export const aiCreditMicros = 10000;
export const planningCostCents = {individual:850,team:1600,team_extra:350};
export const addonOffers = [
 {id:'ai_100',name:'100 AI credits',amount:299,quantity:100,unit:'aiCredits',recurring:false},
 {id:'ai_500',name:'500 AI credits',amount:999,quantity:500,unit:'aiCredits',recurring:false},
 {id:'envelopes_10',name:'10 extra envelopes',amount:999,quantity:10,unit:'envelopes',recurring:false},
 {id:'envelope_1',name:'One extra envelope',amount:100,quantity:1,unit:'envelopes',recurring:false},
 {id:'video_1000',name:'1,000 participant-minutes',amount:999,quantity:1000,unit:'videoMinutes',recurring:false},
 {id:'storage_10gb',name:'10 GB additional storage',amount:299,quantity:10000000000,unit:'storageBytes',recurring:true},
 {id:'sms_starter',name:'SMS Starter · 300 outbound US segments',amount:1499,quantity:300,unit:'smsSegments',recurring:true},
 {id:'sms_segment',name:'Additional prepaid US SMS segment',amount:3,quantity:1,unit:'smsSegments',recurring:false},
].map(x=>Object.freeze({...x,available:false}));
export function aiCreditsForCost(micros){if(!Number.isSafeInteger(micros)||micros<0)throw new Error('Invalid AI cost');return Math.ceil(micros/aiCreditMicros);}
export function launchTotal(plan,seats=1){const total=subscriptionTotal(plan,seats);const base=plan==='team'?teamOffer.monthly:individualOffer.monthly;return total-Math.round(base/2);}
export function validLaunchCoupon(c){const p=c?.applies_to?.products;return Boolean(c?.valid&&c.percent_off===50&&c.duration==='repeating'&&c.duration_in_months===3&&Array.isArray(p)&&p.length===2&&launchProducts.every(x=>p.includes(x)));}
export const individualOffer = { id: 'individual', name: 'Individual', monthly: 2999, annual: 0, seats: 1 };
export const teamOffer = { id: 'team', name: 'Teams', monthly: 4999, annual: 0, seats: 3 };
export const extraSeatOffer = { id: 'team_extra', name: 'Additional team seat', monthly: 999, annual: 0, seats: 1 };
export const currentOffers = [individualOffer, teamOffer];
export const includedFeatures = ['Unlimited appointments', '100 active booking links per host', '5 connected Google accounts per host', 'Client records, notes & appointment history', '25 reminder workflows per workspace', 'Appointment payments through Stripe', 'PDF templates and electronic signatures'];
export function subscriptionTotal(plan, seats = 1) {
  if (!['individual', 'team'].includes(plan)) throw new Error('Choose Individual or Teams.');
  if (!Number.isInteger(seats) || seats < (plan === 'team' ? 3 : 1) || seats > (plan === 'team' ? 1000 : 1)) throw new Error('Choose a valid number of seats.');
  return plan === 'individual' ? individualOffer.monthly : teamOffer.monthly + (seats - 3) * extraSeatOffer.monthly;
}
export function subscriptionLines(plan, seats) {
  subscriptionTotal(plan, seats);
  return [{plan, quantity: 1}, ...(plan === 'team' && seats > 3 ? [{plan:'team_extra', quantity:seats - 3}] : [])];
}
