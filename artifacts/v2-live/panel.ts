import type { PanelModule } from 'nekomimi/extensions';

/** Static sidebar panel: render props.items and filter the visible items with a labelled input. */
export default {
  mount(root, context) {
    const props = context.props as { items?: string[] };
    const items = props.items ?? [];

    const filter = document.createElement('input');
    filter.type = 'text';
    filter.setAttribute('aria-label', 'Live filter');
    filter.placeholder = 'Live filter';

    const list = document.createElement('ul');

    const render = (): void => {
      const visible = items
        .filter((item) => item.includes(filter.value))
        .map((item) => {
          const row = document.createElement('li');
          row.textContent = item;
          return row;
        });
      list.replaceChildren(...visible);
    };

    filter.addEventListener('input', render);
    render();

    root.append(filter, list);
  },
} satisfies PanelModule;
