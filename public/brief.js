// The only script on the page. The agent emits the button markup; this wires it.
document.addEventListener('click', async (event) => {
  const button = event.target.closest('button.action[data-action]');
  if (!button) return;

  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'רגע…';

  const result = document.querySelector('.action-result') ?? (() => {
    const node = document.createElement('span');
    node.className = 'action-result';
    button.after(node);
    return node;
  })();

  try {
    const response = await fetch(`/action/${button.dataset.action}`, { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    result.textContent = body.message ?? (response.ok ? 'בוצע' : 'לא הצליח');
  } catch {
    result.textContent = 'אין חיבור לשרת';
  } finally {
    button.textContent = original;
    button.disabled = false;
  }
});
