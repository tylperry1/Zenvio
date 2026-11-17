declare module "web-push" {
  export type PushSubscription = {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
  export type VapidKeys = { publicKey: string; privateKey: string };
  export type SendResult = { statusCode: number; body: string; headers: Record<string, string> };
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function generateVAPIDKeys(): VapidKeys;
  export function sendNotification(
    subscription: PushSubscription,
    payload?: string | Buffer,
    options?: { TTL?: number; urgency?: string; topic?: string },
  ): Promise<SendResult>;
  const webpush: {
    setVapidDetails: typeof setVapidDetails;
    generateVAPIDKeys: typeof generateVAPIDKeys;
    sendNotification: typeof sendNotification;
  };
  export default webpush;
}
