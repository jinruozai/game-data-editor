/**
 * Component palette — bottom dock, drag-source list grouped by category.
 *
 * Reads EF.listComponents() at mount, filters to the categories that make
 * sense inside a card layout (panel components are excluded), groups them by
 * category, and renders each entry as a draggable iconButton-shaped chip.
 *
 * Drag payload (MIME application/ef.component+json):
 *   { name: <component name> }
 *
 * The cardstyle-editor canvas + cardstyle-tree both register dropzones for
 * this MIME and create new TreeNodes from the dropped name.
 */
(function () {
  'use strict';

  var ui = EF.ui;

  // Categories we surface in the palette, in order. Built-in panel components
  // (tab-*, log, gde-*) live in different dock layers and aren't useful as
  // card children, so we exclude them.
  var CATEGORIES = ['layout', 'display', 'base', 'form', 'editor'];

  function factory(_propsSig, ctx) {
    var root = ui.h('div', 'gde-palette');

    function render() {
      GDE.clear(root);
      var all = EF.listComponents();
      CATEGORIES.forEach(function (cat) {
        var entries = all.filter(function (c) { return c.category === cat; });
        if (!entries.length) return;
        var section = ui.h('div', 'gde-palette-section');
        section.appendChild(ui.h('div', 'gde-palette-cat', { text: cat }));
        var grid = ui.h('div', 'gde-palette-grid');
        entries.forEach(function (e) { grid.appendChild(buildChip(e)); });
        section.appendChild(grid);
        root.appendChild(section);
      });
    }

    function buildChip(spec) {
      var chip = ui.h('div', 'gde-palette-chip', { title: spec.label || spec.name });
      chip.draggable = true;
      var ico = ui.icon({ name: spec.icon || 'square', size: 'sm' });
      var lab = ui.h('span', 'gde-palette-chip-label', { text: spec.label || spec.name });
      chip.appendChild(ico); chip.appendChild(lab);
      chip.addEventListener('dragstart', function (ev) {
        ev.dataTransfer.effectAllowed = 'copy';
        ev.dataTransfer.setData('application/ef.component+json', JSON.stringify({ name: spec.name }));
        // Also expose the component name on a fallback MIME so consumers
        // that only inspect text/* still get a useful payload.
        ev.dataTransfer.setData('text/plain', spec.name);
      });
      return chip;
    }

    render();
    return root;
  }

  EF.registerComponent('gde-cardstyle-palette', {
    category: 'panel',
    label: 'Components',
    icon: 'columns',
    defaults: function () { return { title: 'Components', icon: 'columns' }; },
    factory:  factory,
  });
})();
