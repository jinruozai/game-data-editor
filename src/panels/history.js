/**
 * History panel - project timeline browser.
 */
(function () {
  'use strict';

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function iconButton(icon, title, onClick) {
    var btn = EF.ui.iconButton({
      icon: icon,
      title: title,
      onClick: onClick,
      kind: 'ghost',
      size: 'sm',
    });
    btn.classList.add('gde-history-btn');
    return btn;
  }

  function formatTime(time) {
    var d = new Date(time || Date.now());
    return String(d.getHours()).padStart(2, '0') + ':'
      + String(d.getMinutes()).padStart(2, '0') + ':'
      + String(d.getSeconds()).padStart(2, '0');
  }

  function factory(propsSig, ctx) {
    var root = el('div', 'gde-history');
    var bar = el('div', 'gde-history-bar');
    var title = el('div', 'gde-history-title');
    var actions = el('div', 'gde-history-actions');
    var undoBtn = iconButton('undo', I18N.text('history.undo'), function () { GDE.history.undo(); });
    var redoBtn = iconButton('redo', I18N.text('history.redo'), function () { GDE.history.redo(); });
    actions.append(undoBtn, redoBtn);
    bar.append(title, actions);

    var list = el('div', 'gde-history-list');
    root.append(bar, list);

    ctx.onCleanup(EF.effect(function () {
      var entries = GDE.history.entries();
      var index = GDE.history.index();
      title.textContent = t('history.title');
      undoBtn.disabled = !GDE.history.canUndo();
      redoBtn.disabled = !GDE.history.canRedo();
      GDE.clear(list);

      if (!entries.length) {
        list.appendChild(el('div', 'gde-history-empty', t('history.empty')));
        return;
      }

      for (var i = entries.length - 1; i >= 0; i--) {
        (function (entryIndex) {
          var entry = entries[entryIndex];
          var row = el('button', 'gde-history-row');
          if (entryIndex === index) row.classList.add('is-current');
          if (entryIndex > index) row.classList.add('is-future');
          row.type = 'button';
          row.addEventListener('click', function () { GDE.history.jump(entryIndex); });

          var marker = el('span', 'gde-history-marker');
          var body = el('span', 'gde-history-body');
          var label = el('span', 'gde-history-label', entry.label || t('history.change'));
          var meta = el('span', 'gde-history-meta', formatTime(entry.time));
          body.append(label, meta);
          row.append(marker, body);
          list.appendChild(row);
        })(i);
      }
    }));

    return root;
  }

  EF.registerComponent('gde-history', {
    category: 'panel',
    label: 'History',
    icon: 'clock',
    factory: factory,
    defaults: function () { return { title: t('panel.history'), icon: 'clock', props: {} }; },
  });
})();
