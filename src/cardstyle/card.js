/**
 * Card rendering and grid interaction adapter.
 *
 * Card content is described by a project-level cardStyle tree. The table
 * decides which cardStyle to use; this module only renders a single entity and
 * delegates collection interactions to EF.ui.gridSelection.
 */
(function () {
  'use strict';

  function render(entity, id, pathKey, opts) {
    var card = document.createElement('div');
    card.className = 'gde-card';
    card.dataset.id = id;

    var cs = State.resolveCardStyleForTable(pathKey);
    if (!cs || !cs.root) return card;

    var size = State.cardStyleRootSize(cs);
    var rootW = size.w;
    var rootH = size.h;
    var cardW = opts && typeof opts.width === 'number' && opts.width > 0 ? opts.width : rootW;
    var scale = cardW / rootW;
    var cardH = Math.max(1, Math.round(rootH * scale));
    card.style.width = cardW + 'px';
    card.style.height = cardH + 'px';

    var entitySig = EF.signal(entity || {});
    card.__efEntitySig = entitySig;

    var viewport = document.createElement('div');
    viewport.className = 'gde-card-inner';
    var inner = EF.ui.renderUITree(cs.root, { data: entitySig });
    inner.style.transform = 'scale(' + scale + ')';
    inner.style.transformOrigin = '0 0';
    viewport.appendChild(inner);
    card.appendChild(viewport);
    return card;
  }

  function attachGrid(container, opts) {
    opts = opts || {};
    return EF.ui.gridSelection(container, {
      itemSelector: '.gde-card',
      selectedClass: 'is-selected',
      draggingClass: 'is-dragging',
      initialSelection: opts.initialSelection,
      initialLast: opts.initialLast,
      onSelect: opts.onSelect,
      onReorder: opts.onReorder,
    });
  }

  window.Card = { render: render, attachGrid: attachGrid };
})();
