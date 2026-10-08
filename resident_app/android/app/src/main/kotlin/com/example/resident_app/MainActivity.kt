package com.example.resident_app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val notificationAudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            createSoundChannel(manager, "resident_report_updates", "Report updates", "General updates for reports you submitted", R.raw.resident_report_update)
            createSoundChannel(manager, "resident_report_review", "Report review", "A dispatcher reviewed your incident report", R.raw.report_review)
            createSoundChannel(manager, "resident_responder_enroute", "Responder on the way", "A responder accepted or was dispatched to your incident", R.raw.mdrrmo_dispatch)
            createSoundChannel(manager, "resident_responder_arrived", "Responder arrived", "A responder arrived at your incident location", R.raw.resident_report_update)
            createSoundChannel(manager, "resident_report_resolved", "Report resolved", "Your incident response has been completed", R.raw.report_resolved)
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "ph.gov.mdrrmo.norzagapay/notification_sounds",
        ).setMethodCallHandler { call, result ->
            if (call.method != "play") {
                result.notImplemented()
                return@setMethodCallHandler
            }
            playNotificationSound(call.argument<String>("sound"))
            result.success(null)
        }
    }

    private fun createSoundChannel(
        manager: NotificationManager,
        id: String,
        name: String,
        description: String,
        soundResource: Int,
    ) {
        val soundUri = Uri.parse("android.resource://$packageName/$soundResource")
        val channel = NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH).apply {
            this.description = description
            setSound(soundUri, notificationAudioAttributes)
        }
        manager.createNotificationChannel(channel)
    }

    private fun playNotificationSound(sound: String?) {
        val resource = when (sound) {
            "review" -> R.raw.report_review
            "dispatch" -> R.raw.mdrrmo_dispatch
            "arrival" -> R.raw.resident_report_update
            "resolved" -> R.raw.report_resolved
            else -> return
        }
        val player = MediaPlayer.create(this, resource, notificationAudioAttributes, 0) ?: return
        player.setVolume(0.8f, 0.8f)
        player.setOnCompletionListener { it.release() }
        player.setOnErrorListener { mediaPlayer, _, _ ->
            mediaPlayer.release()
            true
        }
        player.start()
    }
}
