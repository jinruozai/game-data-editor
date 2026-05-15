/**
 * GameDataEditor Inspector asset renderers.
 * Registers img/snd field editors and exposes asset preview helpers used by
 * other project-specific Inspector renderers.
 */
(function () {
  'use strict';

  var ui = EF.ui;

  function isExternalAssetUrl(value) {
    return /^(https?:|data:|blob:)/i.test(String(value || ''));
  }

  function resolveAssetPreview(value) {
    if (!value) return '';
    if (ProjectIO.assets.isAssetUrl(value)) return ProjectIO.assets.urlFor(value);
    return isExternalAssetUrl(value) ? String(value) : '';
  }

  function assetValueExists(value) {
    if (!value) return true;
    if (ProjectIO.assets.isAssetUrl(value)) return ProjectIO.assets.exists(value);
    return isExternalAssetUrl(value);
  }

  function registerAssetRenderers() {
    function assetRenderer(kind, accept) {
      return function (args) {
        var agv = args.fieldDef.type_agv || {};
        return ui.assetPicker({
          value: args.sig,
          onChange: args.write,
          kind: kind,
          accept: agv.accept || accept,
          placeholder: agv.placeholder || agv.suffix || '',
          resolveSrc: resolveAssetPreview,
          exists: assetValueExists,
          onFile: function (file) {
            return ProjectIO.assets.importFile(file, kind, {
              mode: 'property',
              kind: kind,
              field: args.ctx && args.ctx.field,
              selection: args.ctx && args.ctx.selectionSig ? args.ctx.selectionSig.peek() : null,
            });
          },
        });
      };
    }
    ui.registerRenderer('img', assetRenderer('image', '.png,.jpg,.jpeg,.gif,.webp'));
    ui.registerRenderer('snd', assetRenderer('audio', '.mp3,.wav,.ogg'));
  }
  registerAssetRenderers();



  window.InspectorRenderers = Object.assign(window.InspectorRenderers || {}, {
    resolveAssetPreview: resolveAssetPreview,
    assetValueExists: assetValueExists,
  });
})();
