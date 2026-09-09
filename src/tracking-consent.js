const accepted=value=>value===true||value==='true'||value===1;
export function analyticsAllowed(privacy,input={}) {
  if(privacy.analyticsTracking===false)return false;
  const choice=input.analyticsConsentGranted??input.consentGranted;
  if(input.analyticsConsentGranted!==undefined&&!accepted(input.analyticsConsentGranted))return false;
  return !privacy.requireAnalyticsConsent||accepted(choice);
}
