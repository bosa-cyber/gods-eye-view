const panel = document.getElementById('agent-console');
if (panel) {
  const log = panel.querySelector('#agent-log');
  const input = panel.querySelector('#agent-input');
  const form = panel.querySelector('#agent-form');
  const close = panel.querySelector('#agent-close');
  const messages = [];

  function add(role, text) {
    const row = document.createElement('div');
    row.className = 'agent-row ' + role;
    row.textContent = text;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  close?.addEventListener('click', () => {
    panel.hidden = true;
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    add('user', text);
    messages.push({ role: 'user', content: text });
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Agent request failed');
      const answer = data?.choices?.[0]?.message?.content || 'No response.';
      messages.push({ role: 'assistant', content: answer });
      add('assistant', answer);
    } catch (error) {
      add('error', error instanceof Error ? error.message : String(error));
    } finally {
      button.disabled = false;
      input.focus();
    }
  });
}
