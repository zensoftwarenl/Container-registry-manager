resource "google_cloudfunctions2_function" "container_registry_manager" {
  project     = var.project_id
  name        = "ArtifactManager"
  location    = var.region
  description = "Manage Container Registry containers. Searches for and deletes all but last 5 revisions of each registered container."

  build_config {
    runtime     = "nodejs20"
    entry_point = "manageContainerRegistryImages"
    source {
      storage_source {
        bucket = google_storage_bucket.container_manager_source.name
        object = google_storage_bucket_object.container_manager_source_object.name
      }
    }
  }
  service_config {
    min_instance_count = 0
    max_instance_count = 1
    available_memory   = "128Mi"
    timeout_seconds    = 3600
  }

  lifecycle {
    ignore_changes = [
      build_config[0].source[0].storage_source,
      build_config[0].docker_repository
    ]
  }
}

resource "google_service_account" "CR_manager_service_account" {
  project      = var.project_id
  account_id   = "container-manager-invoker-sa"
  display_name = "container-manager-invoker-sa"
  description  = "The service account used by the artifact manager invoker to start the artifact manager"
}


resource "google_cloudfunctions2_function_iam_member" "invoker" {
  project        = google_cloudfunctions2_function.container_registry_manager.project
  location       = google_cloudfunctions2_function.container_registry_manager.location
  cloud_function = google_cloudfunctions2_function.container_registry_manager.name
  role           = "roles/cloudfunctions.invoker"
  member         = "serviceAccount:${google_service_account.CR_manager_service_account.email}"
}

resource "google_cloud_run_service_iam_member" "cloud_run_invoker" {
  project  = google_cloudfunctions2_function.container_registry_manager.project
  location = google_cloudfunctions2_function.container_registry_manager.location
  service  = "projects/${google_cloudfunctions2_function.container_registry_manager.project}/locations/${google_cloudfunctions2_function.container_registry_manager.location}/services/artifactmanager"
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.CR_manager_service_account.email}"
}

resource "google_cloud_scheduler_job" "invoke_cloud_function" {
  name        = "invoke-gcf-function"
  description = "Schedule the HTTPS trigger for cloud function"
  schedule    = "0 0 * * *" # every day at midnight
  project     = google_cloudfunctions2_function.container_registry_manager.project
  region      = "europe-west1"

  attempt_deadline = "1800s"

  http_target {
    uri         = google_cloudfunctions2_function.container_registry_manager.service_config[0].uri
    http_method = "GET"
    oidc_token {
      audience              = "${google_cloudfunctions2_function.container_registry_manager.service_config[0].uri}/"
      service_account_email = google_service_account.CR_manager_service_account.email
    }
  }
}

resource "google_storage_bucket" "container_manager_source" {
  project        = var.project_id
  name           = "${var.project_id}_container_manager_source"
  location       = var.region
  storage_class  = "STANDARD"
  force_destroy  = true
  requester_pays = false
  uniform_bucket_level_access = var.uniform_bucket_level_access
}

data "archive_file" "artifact_manager_source_zip" {
  type        = "zip"
  output_path = "./artifact_manager.zip"
  source {
    filename = "index.js"
    content  = file("${path.module}/../source/index.js")
  }
  source {
    filename = "package.json"
    content  = file("${path.module}/../source/package.json")
  }
}

resource "google_storage_bucket_object" "container_manager_source_object" {
  bucket = google_storage_bucket.container_manager_source.name
  name   = "container_registry_manager_source_${data.archive_file.artifact_manager_source_zip.output_md5}"
  source = data.archive_file.artifact_manager_source_zip.output_path
}