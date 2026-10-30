// Approved USD monthly prices. Existing legacy subscriptions retain their terms.
export const individualOffer = { id: 'individual', name: 'Individual', monthly: 2999, annual: 0, seats: 1 };
export const teamOffer = { id: 'team', name: 'Teams', monthly: 4999, annual: 0, seats: 3 };
export const extraSeatOffer = { id: 'team_extra', name: 'Additional team seat', monthly: 999, annual: 0, seats: 1 };
export const currentOffers = [individualOffer, teamOffer];
export const includedFeatures = ['Unlimited appointments', '100 active booking links per host', '5 connected Google accounts per host', 'Client records, notes & appointment history', '25 reminder workflows per workspace', 'Appointment payments through Stripe', 'PDF templates and electronic signatures', '100 document envelopes per host each month'];
export function subscriptionTotal(plan, seats = 1) {
  if (!['individual', 'team'].includes(plan)) throw new Error('Choose Individual or Teams.');
  if (!Number.isInteger(seats) || seats < (plan === 'team' ? 3 : 1) || seats > (plan === 'team' ? 1000 : 1)) throw new Error('Choose a valid number of seats.');
  return plan === 'individual' ? individualOffer.monthly : teamOffer.monthly + (seats - 3) * extraSeatOffer.monthly;
}
export function subscriptionLines(plan, seats) {
  subscriptionTotal(plan, seats);
  return [{plan, quantity: 1}, ...(plan === 'team' && seats > 3 ? [{plan:'team_extra', quantity:seats - 3}] : [])];
}
