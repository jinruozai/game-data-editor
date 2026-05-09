/**
 * CardStyle list — left dock panel showing every project cardStyle as a
 * tile (name + small live preview rendered with the actual cardStyle root).
 *
 * Click a tile → selection + open transient editor panel in the center
 * dock. Double-click pins it.
 * Right-click context menu: Rename / Duplicate / Delete (Default protected).
 *
 * Add button (+) creates a new empty style with an absolute root, opens it
 * pinned in the editor, and selects it.
 */
(function () {
  'use strict';

  var ui = EF.ui;

  function emptyRoot() {
    return SceneNode.create('absolute', {
      layout: false,
      props: { width: 120, height: 168, background: 'var(--ef-bg-2)', borderRadius: 4 },
    });
  }

  function suggestKey(existing) {
    for (var i = 1; i < 1000; i++) {
      var k = 'card-' + i;
      if (!existing[k]) return k;
    }
    return 'card-' + Date.now();
  }

  function factory(_propsSig, ctx) {
    var root = ui.h('div', 'gde-cs-list');

    var bar = ui.h('div', 'gde-cs-list-bar');
    var addBtn = ui.iconButton({
      icon: 'plus', kind: 'primary', title: I18N.text('cardstyle.add'),
      onClick: function () {
        var cs = State.projectCardStyles();
        var key = suggestKey(cs);
        State.upsertCardStyle(key, { name: 'New style', root: emptyRoot() });
        select(key, true);
      },
    });
    bar.appendChild(addBtn);
    root.appendChild(bar);

    var grid = ui.h('div', 'gde-cs-list-grid');
    grid.addEventListener('click', function (ev) {
      if (ev.target !== grid) return;
      var sel = State.selection();
      if (sel && (sel.kind === 'card_style' || sel.kind === 'card_component')) State.setSelection(null);
    });
    root.appendChild(grid);

    function select(key, pin) {
      State.openCardStyle(key, { transient: !pin });
      var def = State.projectCardStyles()[key];
      if (def && def.root) {
        State.setSelection({ kind: 'card_component', styleKey: key, nodeIds: [def.root.id] });
      } else {
        State.setSelection({ kind: 'card_style', key: key });
      }
      State.showCardStyleTree();
    }

    function buildTile(key, def) {
      var tile = ui.h('div', 'gde-cs-tile');
      tile.dataset.key = key;
      GDE.effect(tile, function () {
        var sel = State.selection();
        var active = sel && ((sel.kind === 'card_style' && sel.key === key)
          || (sel.kind === 'card_component' && sel.styleKey === key));
        EF.untracked(function () { tile.classList.toggle('is-active', !!active); });
      });

      // Mini live preview — renderUITree with an empty data signal so
      // bindings show blanks; the user gets the structural feel.
      var previewWrap = ui.h('div', 'gde-cs-tile-preview');
      if (def && def.root) {
        try {
          var sample = EF.signal({ id: '#sample', name: 'Sample' });
          var p = ui.renderUITree(def.root, { data: sample });
          var size = State.cardStyleRootSize(def);
          var slotW = 76;
          var slotH = 70;
          var scale = Math.min(slotW / size.w, slotH / size.h);
          var holder = ui.h('div', 'gde-cs-preview-holder');
          holder.style.width = Math.round(size.w * scale) + 'px';
          holder.style.height = Math.round(size.h * scale) + 'px';
          p.style.transform = 'scale(' + scale + ')';
          p.style.transformOrigin = '0 0';
          holder.appendChild(p);
          previewWrap.appendChild(holder);
        } catch (e) { /* malformed tree — silent */ }
      }
      tile.appendChild(previewWrap);

      var nameEl = ui.h('div', 'gde-cs-tile-name', { text: def.name || key });
      tile.appendChild(nameEl);

      tile.addEventListener('click',    function () { select(key, false); });
      tile.addEventListener('dblclick', function () { select(key, true); });
      if (GDE.ai && GDE.ai.bindTarget) {
        GDE.ai.bindTarget(tile, function () { return GDE.ai.cardStyleTarget(key); }, { draggable: true });
      }

      tile.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        var items = [];
        if (GDE.ai && GDE.ai.sendTargetsToAI) {
          items.push({
            label: t('common.add_to_chat'),
            icon: 'message-circle',
            onSelect: function () { GDE.ai.sendTargetsToAI([GDE.ai.cardStyleTarget(key)], 'Inspect this card style.'); },
          });
        }
        items.push.apply(items, [
          { label: t('cardstyle.rename'),    onSelect: function () { renameStyle(key); } },
          { label: t('cardstyle.duplicate'), onSelect: function () { duplicateStyle(key); } },
          { type: 'divider' },
          { label: t('cardstyle.delete'), danger: true, disabled: key === 'default',
            onSelect: function () { deleteStyle(key); } },
        ]);
        ui.contextMenu({ x: ev.clientX, y: ev.clientY }, items);
      });

      return tile;
    }

    function renameStyle(key) {
      ui.prompt({ title: t('cardstyle.rename_title'), message: t('cardstyle.new_key'), default: key })
        .then(function (nk) {
          if (!nk || nk === key) return;
          if (key === 'default') { State.log('warn', 'Cannot rename built-in default'); return; }
          try { State.renameCardStyle(key, nk); }
          catch (e) { State.log('error', String(e.message || e)); }
        });
    }
    function duplicateStyle(key) {
      var cs = State.projectCardStyles();
      var src = cs[key]; if (!src) return;
      var nk = suggestKey(cs);
      var clone = JSON.parse(JSON.stringify(src));
      clone.name = (src.name || key) + ' (copy)';
      if (clone.root) SceneNode.retag(clone.root);
      State.upsertCardStyle(nk, clone);
      select(nk, true);
    }
    function deleteStyle(key) {
      ui.confirm({ title: t('cardstyle.delete_title'), message: t('cardstyle.delete_message', { key: key }), danger: true, okLabel: t('common.delete') })
        .then(function (ok) {
          if (!ok) return;
          try { State.deleteCardStyle(key); }
          catch (e) { State.log('error', String(e.message || e)); }
        });
    }
    function paint() {
      GDE.clear(grid);
      var cs = State.projectCardStyles();
      Object.keys(cs).forEach(function (k) { grid.appendChild(buildTile(k, cs[k])); });
    }

    GDE.effect(root, paint);
    ctx.bus.on('cardstyles:changed', paint);
    ctx.bus.on('selection:changed',  function () {
      // Just re-flag the active tile; cheap.
      var sel = State.selection();
      var activeKey = sel && sel.kind === 'card_style'
        ? sel.key
        : (sel && sel.kind === 'card_component' ? sel.styleKey : null);
      Array.from(grid.children).forEach(function (t) {
        t.classList.toggle('is-active', t.dataset.key === activeKey);
      });
    });

    return root;
  }

  EF.registerComponent('gde-cardstyle-list', {
    category: 'panel',
    label: 'Card Styles',
    icon: 'columns',
    defaults: function () { return { title: t('panel.cardstyles'), icon: 'columns' }; },
    factory:  factory,
  });
})();
