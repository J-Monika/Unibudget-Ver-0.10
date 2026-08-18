package com.unibudget.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "NativeExport")
public class NativeExportPlugin extends Plugin {

    private static final String TAG = "NativeExportPlugin";

    @PluginMethod
    public void exportCsv(PluginCall call) {
        String content = call.getString("content");
        String filename = call.getString("filename", "unibudget-export.csv");
        Boolean share = call.getBoolean("share", true);

        if (content == null) {
            call.reject("Content cannot be null");
            return;
        }

        Context context = getContext();
        Uri fileUri = null;
        String savedPath = "/Download/" + filename;

        try {
            byte[] bytes = content.getBytes(StandardCharsets.UTF_8);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Scoped storage using MediaStore (Android 10, 11, 12, 13, 14+)
                ContentResolver resolver = context.getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
                values.put(MediaStore.MediaColumns.MIME_TYPE, "text/csv");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);

                fileUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (fileUri != null) {
                    try (OutputStream os = resolver.openOutputStream(fileUri)) {
                        if (os != null) {
                            os.write(bytes);
                            os.flush();
                        }
                    }
                }
            } else {
                // Legacy storage for older Android versions
                File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloadsDir.exists()) {
                    downloadsDir.mkdirs();
                }
                File targetFile = new File(downloadsDir, filename);
                try (FileOutputStream fos = new FileOutputStream(targetFile)) {
                    fos.write(bytes);
                    fos.flush();
                }
                fileUri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", targetFile);
            }

            if (fileUri != null && Boolean.TRUE.equals(share)) {
                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType("text/csv");
                shareIntent.putExtra(Intent.EXTRA_STREAM, fileUri);
                shareIntent.putExtra(Intent.EXTRA_SUBJECT, filename);
                shareIntent.putExtra(Intent.EXTRA_TEXT, "UniBudget Transactions Export: " + filename);
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(shareIntent, "Share UniBudget Export");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                
                context.startActivity(chooser);
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("filePath", savedPath);
            call.resolve(ret);

        } catch (Exception e) {
            Log.e(TAG, "Failed to export CSV: " + e.getMessage(), e);
            call.reject("Export failed: " + e.getMessage(), e);
        }
    }
}
