const functions = require('@google-cloud/functions-framework');
const fetch = require('node-fetch');
const NUMBER_OF_IMAGES_TO_KEEP = 5
let apiToken
let projectId

functions.http('manageContainerRegistryImages', async (req, res) => {
    let [tagsDeleted, imagesDeleted, numberOfImages] = await manageContainerRegistryImages()

    let percentDeleted = ((imagesDeleted/numberOfImages)*100).toFixed(2)

    console.log(`Finished managing container images. Deleted ${imagesDeleted}/${numberOfImages} (${percentDeleted}%). Also deleted ${tagsDeleted} tags.`)

    // Send an HTTP response
    res.send(`Finished managing container images. Deleted ${imagesDeleted}/${numberOfImages} (${percentDeleted}%). Also deleted ${tagsDeleted} tags.`);
});

/**
 * Collects, sorts, deletes tags and deletes the images of container registries used by the project.
 *
 * @returns {Promise<[number]>} Returns an array of 2, with first the number of tags deleted, second the number of images deleted.
 */
async function manageContainerRegistryImages(){
    apiToken = await getAccessToken()
    projectId = await getProjectId()

    // Get all Repositories for the given registry urls
    let repositories = await getGCRRepositories(['https://gcr.io/v2', 'https://eu.gcr.io/v2'])

    // Get all images for the given repositories
    let imageListPerRepo = await getGCRImageListPerRepo(repositories, projectId)

    // Sort the image list by oldest creation date first
    sortImageList(imageListPerRepo)

    // Remove some images form the list to prevent them form being deleted
    removeImagesToBeKeptFromImageList(imageListPerRepo)

    // Get the total number of images
    let numberOfImages = getTotalImageCount(imageListPerRepo)

    let tagsDeleted = 0
    let imagesDeleted = 0;

    // Loop through all repositories and images to delete them
    for (const repoImageListKey in imageListPerRepo){
        for (const imageKey in imageListPerRepo[repoImageListKey]){
            let image = imageListPerRepo[repoImageListKey][imageKey]
            // Delete tags (if they exist) for the given image
            tagsDeleted += await deleteTagsForImage(image)
            // Delete the given image
            imagesDeleted += await deleteImage(image)
        }
    }
    return [tagsDeleted, imagesDeleted, numberOfImages]
}

/**
 * Returns the bearer token used for authenticating against google services
 *
 * @returns {Promise<string>} Bearer token. Returns the bearer token used for authenticating against google services
 */
async function getAccessToken(){
    let token = null;

    if(process.env.NODE_ENV === "local"){
        // gcloud auth print-access-token --project=PROJECT_ID // Expires after 2 hours
        token = "token"
    }
    else {
        let scope = "https://www.googleapis.com/auth/cloud-platform"
        let url = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=${scope}`

        let headers = { 'Metadata-Flavor': 'Google' };
        try {
            const response = await fetch(url, {headers: headers});
            let responseJson = await response.json()
            token = responseJson.access_token
        } catch (error) {
            console.log('error while fetching ID token', error);
        }
    }

    return token
}

/**
 * Get the project id of the project the cloud function is running in.
 *
 * @returns {Promise<string>} Project id of the project the function is running in
 */
async function getProjectId(){
    let project_id = null;

    if(process.env.NODE_ENV === "local"){
        project_id = "filogic-site-prod-0306"
    }
    else {
        let url = `http://metadata.google.internal/computeMetadata/v1/project/project-id`
        let headers = { 'Metadata-Flavor': 'Google' };
        try {
            const response = await fetch(url, {headers: headers});
            let responseJson = await response.text()
            project_id = responseJson
        } catch (error) {
            console.log('error while fetching project id', error);
        }
    }

    return project_id
}

/**
 * Delete All the tags for the given image.
 *
 * @param imageData The image data for the tag that needs to be deleted. (Required data is in the image data)
 * @param recursiveCall {boolean} Default false, value that is added when the call is recursive, used to prevent infinite loop
 * @returns {Promise<number>} Returns 1 if deleted, 0 if not
 */
async function deleteTagsForImage(imageData, recursiveCall = false){
    let tagsDeleted = 0

    for (let x=0; x<imageData.tag.length; x++){
        let url = `${imageData.url}/manifests/${imageData.tag[x]}`
        let header = getRequestHeader()
        let options = {
            "headers": header,
            "method" : "DELETE"
            // "method" : "GET"
        }
        let response = await fetch(url, options)

        if (response.status === 200 ||  response.status === 202){
            console.log(`Deleted Tag: ${imageData.tag[x]}`)
            tagsDeleted += 1
        }
        else if(response.status === 401 && !recursiveCall){
            apiToken = await getAccessToken()
            tagsDeleted += await deleteTagsForImage(imageData, true)
        }
        else {
            console.log(`ERROR: Failed to delete Tag: ${imageData.tag[x]}`)

            console.log(`Status: ${response.status}, StatusText: ${response.statusText}`)
        }
    }
    return tagsDeleted
}

/**
 * Delete the specified image form the container registry. Make sure to have deleted any tags used by the image.
 *
 * @param imageData The specific image that needs to be deleted
 * @param recursiveCall {boolean} Default false, value that is added when the call is recursive, used to prevent infinite loop
 * @returns {Promise<number>} Returns 1 if deleted, 0 if not
 */
async function deleteImage(imageData, recursiveCall = false){
    let url = `${imageData.url}/manifests/${imageData.name}`
    let header = getRequestHeader()
    let options = {
        "headers": header,
        "method" : "DELETE"
        // "method" : "GET"
    }
    let response = await fetch(url, options)

    if (response.status === 200 ||  response.status === 202){
        console.log(`Deleted revision: ${imageData.url}@${imageData.name}`)
        return 1
    }
    else if(response.status === 401 && !recursiveCall){
        apiToken = await getAccessToken()
        return await deleteImage(imageData, true)
    }
    else {
        console.log(`ERROR: Failed to delete revision: ${imageData.url}@${imageData.name}`)
        console.log(`Status: ${response.status}, StatusText: ${response.statusText}`)
        return 0
    }
}

/**
 * Remove NUMBER_OF_IMAGES_TO_KEEP number of items form the end of the array.
 * This is used to keep NUMBER_OF_IMAGES_TO_KEEP from being deleted.
 *
 * @param imageListPerRepo {repository[image[]]} (The result form getGCRImageListPerRepo)
 * @see getGCRImageListPerRepo
 */
function removeImagesToBeKeptFromImageList(imageListPerRepo){
    for (const repoImageList in imageListPerRepo){
        imageListPerRepo[repoImageList].splice(-NUMBER_OF_IMAGES_TO_KEEP, NUMBER_OF_IMAGES_TO_KEEP)
    }
}

/**
 * Sorts the given child array by a.timeUploadedMs - b.timeUploadedMs
 *
 * @param imageListPerRepo {repository[image[]]} (The result form getGCRImageListPerRepo)
 * @see getGCRImageListPerRepo
 */
function sortImageList(imageListPerRepo){
    for (const repoImageList in imageListPerRepo){
        imageListPerRepo[repoImageList].sort((a, b) => a.timeUploadedMs - b.timeUploadedMs)
    }
}

/**
 * Get the total number of images in the provided repository lists.
 *
 * @param imageListPerRepo {repository[image[]]} (The result form getGCRImageListPerRepo)
 * @see getGCRImageListPerRepo
 * @returns {number} The number of images in the provided lists
 */
function getTotalImageCount(imageListPerRepo){
    let totalImages = 0;
    for (const repoImageList in imageListPerRepo){
        totalImages += imageListPerRepo[repoImageList].length
    }
    return totalImages
}

/**
 * Get all Images under the given repositories. Groups result into array per repository
 *
 * @param repositories {string[]} Repositories to get the images for. Repository needs to be a valid container registry url
 * @param projectId {string} The project id of the current project
 * @returns {Promise<string[any]>} Return a multidimensional array of images per repo listed under repo[images[]]
 */
async function getGCRImageListPerRepo(repositories, projectId) {
    let imageList = [];
    for (const repository of repositories) {
        // Only mange repositories that are part of this project
        if (repository.includes(projectId)) {
            // Get all revisions / versions / digests under the given repository
            let url = `${repository}/tags/list`
            let header = getRequestHeader()
            let response = await fetch(url, {"headers": header})
            let responseJson = await response.json()

            let list = []

            // convert object list to array
            for (const key in responseJson.manifest){
                if (responseJson.manifest.hasOwnProperty(key)){
                    const item = responseJson.manifest[key]

                    // add key as a name value (key == digest sha)
                    item.name = key

                    //Add the url from repository to the object so the origin url can be retrieved
                    item.url = repository

                    list.push(item)
                }
            }

            imageList[repository] = list
        }
    }

    // console.log(imageList)

    return imageList
}

/**
 * Get a list of repository urls that are under the given container registry url
 *
 * @param urls {string[]} Array of strings containing the url to check for containers to manage. Example  -> ["https://gcr.io"]
 * @returns {Promise<string[]>} return a list of repository urls that are under the given url
 */
async function getGCRRepositories(urls){
    let repositories = []

    for (let key in urls){
        // Call (and wait for response) on the _catalog route that will return all repositories under the given base url
        let url = `${urls[key]}/_catalog`
        let header = getRequestHeader()
        let response = await fetch(url, {"headers":header})
        let responseJson = await response.json()

        // console.log(responseJson)

        //covert the base repo name returned by the call to a usable url for future calls.
        for(let x=0;x<responseJson.repositories.length;x++){
            responseJson.repositories[x] = convertRepoNameToUrlBasedRepoName(responseJson.repositories[x], urls[key])
        }

        repositories.push(responseJson.repositories)
    }

    // flatten the array to a single dimension
    repositories = [].concat(...repositories);

    return repositories
}

/**
 * Create the url usable by the api to make subsequent calls for that specific repository
 *
 * @param repo The name of the repository that you want to generate the url for. Example: agile-analytics-prod-d7e7/app-engine-tmp/app/api/ttl-18h
 * @param url The base url of the container registry. Example: https://gcr.io/v2
 * @returns {string} ${url}/${repo} -> https://gcr.io/v2/agile-analytics-prod-d7e7/app-engine-tmp/app/api/ttl-18h
 */
function convertRepoNameToUrlBasedRepoName(repo, url){
    return `${url}/${repo}`
}

/**
 * Create an object containing the required authorization elements
 *
 * @returns {{Authorization: string}}
 */
function getRequestHeader(){
    return {
        "Authorization": "Bearer " + apiToken,
    }
}

module.exports = {
    getProjectId,
    getAccessToken,
    getRequestHeader,
    getGCRRepositories,
    getGCRImageListPerRepo,
    getTotalImageCount,
    convertRepoNameToUrlBasedRepoName,
    sortImageList,
    removeImagesToBeKeptFromImageList,
    deleteImage,
    deleteTagsForImage,
    manageContainerRegistryImages,
    fetch,
}