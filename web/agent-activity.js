// Task lifetime is separate from the agent's last reported health/status.
(() => {
  const tasks = new Map();
  function update(name) {
    const busy = (tasks.get(name) || 0) > 0;
    const tile = document.querySelector('[data-actor="' + name + '"]');
    const card = document.querySelector('[data-agent="' + name + '"]');
    if (tile) tile.dataset.busy = String(busy);
    if (card) card.classList.toggle('task-active', busy);
  }
  window.withAgentActivity = async (names, work) => {
    const agents = [...new Set(names)];
    for (const name of agents) { tasks.set(name, (tasks.get(name) || 0) + 1); update(name); }
    try { return await work(); }
    finally {
      for (const name of agents) { tasks.set(name, Math.max(0, (tasks.get(name) || 0) - 1)); update(name); }
    }
  };
})();
