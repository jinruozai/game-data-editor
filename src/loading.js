/**
 * GDE.loading — small application-level loading overlay.
 *
 * Long project IO belongs to GameDataEditor, not the generic framework.
 * The module only owns presentation and progress state; callers provide
 * concrete steps through a narrow progress callback.
 */
(function () {
  'use strict';

  var GDE = window.GDE = window.GDE || {};
  var current = null;

  function show(options) {
    options = options || {};
    if (current) current.hide();

    var overlay = document.createElement('div');
    overlay.className = 'gde-loading-overlay';

    var panel = document.createElement('div');
    panel.className = 'gde-loading-panel';

    var title = document.createElement('div');
    title.className = 'gde-loading-title';

    var message = document.createElement('div');
    message.className = 'gde-loading-message';

    var track = document.createElement('div');
    track.className = 'gde-loading-track is-indeterminate';
    var bar = document.createElement('div');
    bar.className = 'gde-loading-bar';
    track.appendChild(bar);

    var detail = document.createElement('div');
    detail.className = 'gde-loading-detail';

    panel.appendChild(title);
    panel.appendChild(message);
    panel.appendChild(track);
    panel.appendChild(detail);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    var api = {
      update: function (patch) {
        patch = patch || {};
        if (patch.title != null) title.textContent = String(patch.title);
        if (patch.message != null) message.textContent = String(patch.message);
        if (patch.detail != null) detail.textContent = String(patch.detail);

        var progress = progressValue(patch);
        if (progress == null) {
          track.classList.add('is-indeterminate');
          bar.style.width = '';
          if (patch.detail == null && patch.current != null && patch.total != null) {
            detail.textContent = patch.current + ' / ' + patch.total;
          }
          return;
        }
        track.classList.remove('is-indeterminate');
        bar.style.width = Math.round(progress * 100) + '%';
        if (patch.detail == null) {
          detail.textContent = patch.current != null && patch.total != null
            ? patch.current + ' / ' + patch.total
            : Math.round(progress * 100) + '%';
        }
      },
      hide: function () {
        if (current !== api) return;
        current = null;
        overlay.classList.add('is-hiding');
        setTimeout(function () { overlay.remove(); }, 120);
      },
    };

    current = api;
    api.update({
      title: options.title || 'Loading',
      message: options.message || '',
      progress: options.progress,
      current: options.current,
      total: options.total,
      detail: options.detail || '',
    });
    return api;
  }

  async function run(options, task) {
    var loading = show(options);
    try {
      return await task(function (patch) { loading.update(patch); });
    } finally {
      loading.hide();
    }
  }

  function progressValue(patch) {
    if (patch.indeterminate) return null;
    if (typeof patch.progress === 'number' && isFinite(patch.progress)) {
      return clamp01(patch.progress);
    }
    if (typeof patch.current === 'number' && typeof patch.total === 'number' && patch.total > 0) {
      return clamp01(patch.current / patch.total);
    }
    return null;
  }

  function clamp01(n) { return Math.max(0, Math.min(1, n)); }

  function nextFrame() {
    return new Promise(function (resolve) { requestAnimationFrame(function () { resolve(); }); });
  }

  GDE.loading = {
    show: show,
    run: run,
    nextFrame: nextFrame,
  };
})();
