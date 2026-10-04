allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// camera-core 1.5.3 references CallbackToFutureAdapter in type annotations,
// but does not expose concurrent-futures on camera_android_camerax's compile
// classpath. Keep the dependency local to the plugin project so javac can
// resolve those annotations. The Flutter plugin loader may evaluate plugin
// projects before this root build script finishes.
gradle.projectsEvaluated {
    rootProject.findProject(":camera_android_camerax")?.let { cameraPlugin ->
        cameraPlugin.dependencies.add(
            "implementation",
            "androidx.concurrent:concurrent-futures:1.2.0",
        )
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
