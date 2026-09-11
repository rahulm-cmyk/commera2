export function mountBotanicalControls(form,settings,escape) {
  const e=value=>escape(String(value??''));
  form.querySelector('[data-store-section-panel="theme-settings"]').insertAdjacentHTML('afterbegin',`<label class="field">Storefront style<select name="themeDesign"><option value="classic">Classic</option><option value="botanical">Editorial</option></select></label>`);
  form.elements.themeDesign.value=settings.design||'classic';
  const banner=form.querySelector('[name="bannerHeading"]').closest('fieldset');
  banner.insertAdjacentHTML('beforeend',`<div class="botanical-banner-controls"><label class="field">Small heading<input name="heroEyebrow" value="${e(settings.heroEyebrow)}" maxlength="100"></label><label class="field">Highlighted heading<input name="heroAccent" value="${e(settings.heroAccent)}" maxlength="100"></label><label class="field">Second button text<input name="heroSecondaryText" value="${e(settings.heroSecondaryText)}" maxlength="60"></label><label class="field">Second button link<input name="heroSecondaryUrl" value="${e(settings.heroSecondaryUrl)}"></label><label class="field">Highlights<textarea name="heroBadges" rows="4">${e((settings.heroBadges||[]).join('\n'))}</textarea></label></div>`);
}

export function readBotanicalSettings(form) {
  const read=name=>form.elements[name]?.value||'';
  return {design:read('themeDesign')||'classic',heroEyebrow:read('heroEyebrow'),heroAccent:read('heroAccent'),heroSecondaryText:read('heroSecondaryText'),heroSecondaryUrl:read('heroSecondaryUrl'),heroBadges:read('heroBadges').split('\n').map(value=>value.trim()).filter(Boolean).slice(0,4)};
}
