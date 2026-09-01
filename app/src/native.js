/* ================================================================
   PLANK PLAN — the native shell
   Loaded only in the app builds; the web version never sees this file.

   No bundler here either. Capacitor registers its plugins on
   window.Capacitor.Plugins at runtime, so they can be called from a plain
   script, which keeps the app the same self-contained page it is on the web.

   Everything in here is additive and defensive: if a plugin is missing, a
   consent form fails to load or an ad never fills, the calculator carries on
   working. A flooring calculator that will not open because an ad server is
   down is worse than one with no ads.
   ================================================================ */
(function(){
  "use strict";

  const Cap = window.Capacitor;
  if(!Cap || typeof Cap.isNativePlatform !== "function" || !Cap.isNativePlatform()) return;
  const P = Cap.Plugins || {};
  const platform = Cap.getPlatform();

  /* ---------------------------------------------------------------
     AD CONFIGURATION

     These are Google's public test unit IDs. They serve real-looking ads
     that earn nothing and, crucially, cannot get your AdMob account
     suspended when you tap your own ad while testing — which live units
     will. Replace them with your own from the AdMob console and set
     `testing: false` only when you are ready to ship.

     The matching *application* IDs go in the native projects, not here:
     android/app/src/main/AndroidManifest.xml and ios/App/App/Info.plist.
     --------------------------------------------------------------- */
  const ADS = {
    androidBanner: "ca-app-pub-3940256099942544/6300978111",   // Google test banner
    iosBanner:     "ca-app-pub-3940256099942544/2934735716",   // Google test banner
    testing: true
  };

  const bannerId = platform === "ios" ? ADS.iosBanner : ADS.androidBanner;
  const LIVE_LOOKS_LIKE_TEST = /^ca-app-pub-3940256099942544/;

  /* ---- the space the banner takes off the floor plan ---- */
  const root = document.documentElement;
  function setAdInset(px){
    root.style.setProperty("--ad-inset", Math.max(0, Math.round(px || 0)) + "px");
    // The plan sizes itself off the viewport, so it has to be told.
    window.dispatchEvent(new Event("resize"));
  }

  /* ---- status bar ---- */
  async function styleShell(){
    const { StatusBar } = P;
    if(!StatusBar) return;
    try{
      // The app is dark; the status bar text must be light to match.
      await StatusBar.setStyle({ style: "DARK" });
      if(platform === "android") await StatusBar.setBackgroundColor({ color: "#1E2A26" });
    }catch(err){ /* not every device lets us */ }
  }

  /* ---------------------------------------------------------------
     CONSENT, then ads.

     Order matters and is not optional. In the EEA and UK a personalised
     ad may not be served before the user has been asked, and on iOS the
     tracking prompt is a separate ask on top of that. Getting this wrong
     is the usual reason an app is pulled rather than a reason it earns
     less.
     --------------------------------------------------------------- */
  async function startAds(){
    const { AdMob } = P;
    if(!AdMob) return;

    if(!ADS.testing && LIVE_LOOKS_LIKE_TEST.test(bannerId)){
      console.warn("[PlankPlan] testing is off but the ad unit is still Google's test ID.");
    }

    try{
      await AdMob.initialize({ initializeForTesting: ADS.testing });
    }catch(err){
      console.warn("[PlankPlan] AdMob would not start; carrying on without ads.", err);
      return;
    }

    // Assume no personalisation until the user says otherwise. Serving a
    // non-personalised ad to someone who would have consented costs a little
    // revenue; the other way round costs a lot more than that.
    let personalised = false;
    try{
      let info = await AdMob.requestConsentInfo();
      if(info.status === "REQUIRED" && info.isConsentFormAvailable){
        info = await AdMob.showConsentForm();
      }
      personalised = info.status === "OBTAINED" || info.status === "NOT_REQUIRED";
    }catch(err){
      console.warn("[PlankPlan] no consent form; serving non-personalised ads.", err);
    }

    // iOS asks separately, and only after the UMP form so the two prompts
    // do not land on top of one another.
    if(platform === "ios"){
      try{
        const t = await AdMob.trackingAuthorizationStatus();
        if(t.status === "notDetermined") await AdMob.requestTrackingAuthorization();
      }catch(err){ /* pre-iOS 14, or refused */ }
    }

    try{
      await AdMob.addListener("bannerAdSizeChanged", size => setAdInset(size && size.height));
      await AdMob.addListener("bannerAdFailedToLoad", () => setAdInset(0));
      await AdMob.addListener("bannerAdLoaded", () => {});
    }catch(err){ /* listeners are a nicety, not a requirement */ }

    try{
      await AdMob.showBanner({
        adId: bannerId,
        adSize: "ADAPTIVE_BANNER",
        position: "BOTTOM_CENTER",
        margin: 0,
        isTesting: ADS.testing,
        npa: !personalised
      });
    }catch(err){
      console.warn("[PlankPlan] no banner; carrying on without one.", err);
      setAdInset(0);
    }
  }

  /* ---------------------------------------------------------------
     Saving a plan.

     The web build downloads a file, which a WebView will not do. Sharing
     the plan through the system sheet is the native equivalent and puts it
     wherever the user actually wants it — Files, Drive, a message to the
     fitter. This replaces savePlan() only when the plugins are there.
     --------------------------------------------------------------- */
  async function sharePlan(){
    const { Filesystem, Share } = P;
    const json = document.getElementById("plan-text").value;
    const name = (typeof slug === "function" ? slug(window.state && state.name) : "plan")
                 + ".plankplan.json";
    if(!Filesystem || !Share) return false;
    try{
      const w = await Filesystem.writeFile({
        path: name, data: json, directory: "CACHE", encoding: "utf8"
      });
      await Share.share({
        title: (window.state && state.name) || "Plank Plan",
        text: "Plank Plan — flooring plan",
        url: w.uri,
        dialogTitle: "Save or send this plan"
      });
      return true;
    }catch(err){
      // A cancelled share sheet throws too, which is not an error worth saying
      // anything about.
      return true;
    }
  }

  function wireSave(){
    const btn = document.getElementById("save-plan");
    if(!btn) return;
    const native = btn.cloneNode(true);        // drop the web download handler
    native.textContent = "Share";
    btn.parentNode.replaceChild(native, btn);
    native.addEventListener("click", async () => {
      if(typeof writePlanText === "function") writePlanText(true);
      const done = await sharePlan();
      if(!done && typeof toast === "function"){
        toast("Could not open the share sheet. Copy the plan text in the panel instead.", true);
      }
    });
  }

  /* ---- a small tap response on the tools, which a phone expects ---- */
  function wireHaptics(){
    const { Haptics } = P;
    if(!Haptics) return;
    const tap = () => { try{ Haptics.impact({ style: "LIGHT" }); }catch(err){} };
    ["tool-select","tool-draw","zoom-fit","best-stagger","balance"].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.addEventListener("click", tap);
    });
  }

  function boot(){
    document.documentElement.classList.add("native", "native-" + platform);
    styleShell();
    wireSave();
    wireHaptics();
    // Ads last: nothing above depends on them, and the consent form should
    // not be the first thing on screen before the app has drawn.
    setTimeout(startAds, 600);
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
