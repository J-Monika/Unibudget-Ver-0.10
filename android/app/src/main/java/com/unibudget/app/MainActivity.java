package com.unibudget.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register native plugins before the bridge loads.
        registerPlugin(GcashWatcherPlugin.class);
        registerPlugin(NativeExportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
