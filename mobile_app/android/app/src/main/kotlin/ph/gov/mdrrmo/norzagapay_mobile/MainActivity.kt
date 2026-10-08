package ph.gov.mdrrmo.norzagapay_mobile

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
            createSoundChannel(
                manager,
                "resident_incidents",
                "Resident incident reports",
                "Urgent alerts for newly submitted resident incidents",
                R.raw.resident_incident,
            )
            createSoundChannel(
                manager,
                "mdrrmo_dispatches",
                "MDRRMO dispatch assignments",
                "New reports assigned to MDRRMO responders",
                R.raw.mdrrmo_dispatch,
            )
            createSoundChannel(
                manager,
                "resident_report_updates",
                "Resident report updates",
                "Progress updates for reports submitted by residents",
                R.raw.resident_report_update,
            )
            createSoundChannel(
                manager,
                "assistance_requests",
                "Assistance requests",
                "Responder requests for additional assistance or resources",
                R.raw.assistance_request,
            )
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
        val channel = NotificationChannel(
            id,
            name,
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            this.description = description
            setSound(soundUri, notificationAudioAttributes)
        }
        manager.createNotificationChannel(channel)
    }

    private fun playNotificationSound(sound: String?) {
        val resource = when (sound) {
            "residentIncident" -> R.raw.resident_incident
            "mdrrmoDispatch" -> R.raw.mdrrmo_dispatch
            "residentReportUpdate" -> R.raw.resident_report_update
            "assistanceRequest" -> R.raw.assistance_request
            else -> return
        }
        val player = MediaPlayer.create(this, resource, notificationAudioAttributes, 0)
            ?: return
        player.setVolume(0.8f, 0.8f)
        player.setOnCompletionListener { it.release() }
        player.setOnErrorListener { mediaPlayer, _, _ ->
            mediaPlayer.release()
            true
        }
        player.start()
    }
}
