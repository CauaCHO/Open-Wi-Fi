export const STANDARD_PLANS = {
  '1h':  { id: '1h', label: '1 hora', amount: 2, durationMs: 60 * 60 * 1000, note: 'Acesso rápido' },
  '1d':  { id: '1d', label: '1 dia', amount: 5, durationMs: 24 * 60 * 60 * 1000, note: 'Até 24 horas' },
  '7d':  { id: '7d', label: '1 semana', amount: 10, durationMs: 7 * 24 * 60 * 60 * 1000, note: '7 dias de acesso' },
  '30d': { id: '30d', label: '30 dias', amount: 25, durationMs: 30 * 24 * 60 * 60 * 1000, note: 'Melhor custo', featured: true }
};

export const PARTY_PLANS = {
  'party-1h': { id: 'party-1h', label: '1 hora', amount: 2, durationMs: 60 * 60 * 1000, note: 'Pra dar aquela conectada' },
  'night': { id: 'night', label: 'Vale Night', amount: 5, untilEventEnd: true, note: 'Até o fim do evento' },
  'duo': { id: 'duo', label: 'Combo Dupla', amount: 8, untilEventEnd: true, comboSlots: 2, note: '2 aparelhos no mesmo convite', featured: true },
  'quartet': { id: 'quartet', label: 'Quarteto', amount: 12, untilEventEnd: true, comboSlots: 4, note: '4 aparelhos no mesmo convite' }
};

export function allPlanCatalog() {
  return { ...STANDARD_PLANS, ...PARTY_PLANS };
}

export function modePlans(mode = 'standard') {
  return mode === 'party' ? PARTY_PLANS : STANDARD_PLANS;
}

export function publicPlan(plan) {
  if (!plan) return null;
  return {
    id: plan.id,
    label: plan.label,
    amount: plan.amount,
    note: plan.note || '',
    featured: Boolean(plan.featured),
    comboSlots: Number(plan.comboSlots || 0),
    untilEventEnd: Boolean(plan.untilEventEnd)
  };
}

export function planFromAttempt(attempt) {
  if (attempt?.planSnapshot) return attempt.planSnapshot;
  return allPlanCatalog()[attempt?.plan] || null;
}
