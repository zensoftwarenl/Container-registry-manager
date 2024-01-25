# Zensoftware Container Registry Manager

Welcome to Zensoftware Container Registry Manager, a powerful open-source tool designed to simplify and enhance the management of Docker images within Google Cloud Platform's Container Registry.

Our project aims to address the challenge of automating the management of the GCR container registry. It does this by providing a comprehensive solution for identifying and cleaning up old, unused Docker images, ensuring optimal storage utilization and a reduction in storage costs.

# Key Features

1. Automated Cleanup: Zensoftware Container Registry Manager automates the process of identifying and removing outdated Docker images, freeing up valuable storage space in your GCP Container Registry. This automation helps maintain a lean and efficient image repository.

2. Customizable Policies: Tailor the cleanup process to suit your specific requirements with customizable policies. Define criteria such as image age, tag patterns, and usage frequency to ensure that only the images you no longer need are removed, preserving critical resources.

3. Idempotent Operations: Experience the reliability of idempotent operations with Zensoftware Container Registry Manager. Whether you run the cleanup process once or a thousand times, the result remains consistent. This ensures predictability and stability in your containerized environment.

# Setup
To setup the Container manager, there are 2 main options. Either use Terraform to manage the infrastructure or you can manually setup the container manager

## Terraform

When using Terraform to manage the container manager, just include the following code replace the values with the correct ones. 
~~~
module "artifact_manager" {
  source = "git@gitlab.com:zensoftwarenl/caas/tools/artifactmanager.git//infrastructure"

  project_id = <project_id>
  region     = <region_to_run_in>
}
~~~

For the other optional flags check the [infrastructue/README.md](infrastructure/README.md). 

## Manual

The manual installation will be more 'hands on' as you will need to complete some extra steps. 

1. First download the source code form the [Source](source) directory.  
2. Create a Gen2 Cloud Function in your project
   1.  Configure the trigger to HTTPS with required authentication <br> (name and region can be what you wish)
   2. In the runtime config configure the memory to be 128Mi, if you leave this higher you might have higher costs for no benefit. 
   3. Click "next"
   4. Here you will need to add the source code. You can either:
      1. Upload the index.js and package.json. OR
      2. Create a zip of the source code and upload that instead
   5. Set the runtime to "Node.js 20"
   6. Set the entry point to "manageContainerRegistryImages"
   7. Click the "deploy" button
3.  Navigate to cloud scheduler
4. Click the "Create Job" button
5. Here configure the following things
   1. Name: Can be what you wish, I recommend something descriptive including the function name
   2. Region: This must match the region the function is deployed in
   3. Description: Add what you think is a fitting description
   4. Frequency: Configure here how often you want to run the container manager. For example "0 0 * * *" Every day at midnight
   5. Timezone: The timezone you are in, or the timezone that you want the conatainer manager to follow
6. Click "continue"
7. Here configure the "Target type" to be "HTTP"
8. In "URL" insert the url of the cloud function (you can find this in the cloud function you deployed)
9. In the "Auth Header" select "Add OIDC token" (This opens a new menu)
10. Under "Service account" select the service account you want to use. <br> (If you don't know what to choose, select the "Compute Engine default service account)
11. Click the "Create" button
12. You should now see the scheduler job in the list. <br> (If you wish to run it click the dots on the end of the line, and click "force run" ) 
13. That's it! You have deployed the container manager 

After following these steps you should have the container manager running and should see the size of your container registry shrink after completing the first run, 
