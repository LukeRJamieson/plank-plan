package com.lukejamieson.plankplan;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // The AdMob banner sits below the WebView rather than over it, so on a
        // wide screen the strip either side of a centred banner is window, not
        // page. CSS cannot reach out there, and setting windowBackground in the
        // theme does not stick because the activity keeps its splash theme —
        // so paint the window itself. Anything the WebView does not cover is
        // then the same cutting-mat green as the app.
        getWindow().setBackgroundDrawableResource(R.color.plankMat);
    }
}
