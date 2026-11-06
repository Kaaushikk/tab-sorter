export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function button(label: string, action: () => void | Promise<void>, className?: string): HTMLButtonElement {
  const b = el('button', label, className); b.type = 'button'; b.addEventListener('click', () => { void action(); }); return b;
}
export function field(label: string, input: HTMLElement, help?: string): HTMLLabelElement {
  const l = el('label', undefined, 'field'); l.append(el('span', label), input);
  if (help) l.append(el('small', help)); return l;
}
