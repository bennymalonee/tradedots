export function safeTransferState(input) {
  const state = structuredClone(input.state || input);
  if (state.schema!==1 || !Number.isSafeInteger(state.cash_cents) || !Number.isSafeInteger(state.initial_cents) || !Array.isArray(state.positions) || !Array.isArray(state.ledger) || !Array.isArray(state.observations) || !state.config) {
    throw Error('A full desk_state snapshot is required. The dashboard ledger export is incomplete and cannot restore the account.');
  }
  // Credentials must be configured again on the destination, not transferred with memory.
  delete state.ai_connection;
  state.running=false;state.halted=true;state.halt_reason='Migration: verify accounts and data before resuming';
  state.tick_lease=null;
  if(state.research) {
    state.research.enabled=false;state.research.lease=null;
    state.research.connection_epoch=(state.research.connection_epoch||0)+1;
    for(const report of state.research.reports||[]) if(report.status==='running')report.status='interrupted';
  }
  if(state.simulation)state.simulation.enabled=false;
  return state;
}
