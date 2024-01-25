const sinon = require('sinon');
// require('../index.js')
const index = require('../index')
const {getTestServer} = require('@google-cloud/functions-framework/testing');
const nock = require('nock')
const supertest = require('supertest');
// const fetch = require('node-fetch');
const fetchMock = require('fetch-mock');
const assert = require('assert');

describe('Container registry manager test', function () {
    let projectIdStub;
    let tokenStub;
    let consoleLogStub;

    beforeEach(() => {
        // setup stub for access token
        let stub = sinon.stub();
        stub.resolves("test_access_token")
        tokenStub = sinon.stub(index, "getAccessToken").callsFake(stub)

        // setup stub for project id
        stub = sinon.stub()
        stub.resolves("test_project_id")
        projectIdStub = sinon.stub(index, "getProjectId").callsFake(stub)

        consoleLogStub = sinon.stub(console, "log").callsFake(()=>{})
    })

    afterEach(() => {
        projectIdStub.restore()
        tokenStub.restore()
        consoleLogStub.restore()
    })

    it('should test if the development mode works for the project id get', async function () {
        projectIdStub.restore()
        process.env.NODE_ENV = "local"
        let result = await index.getProjectId()
        process.env.NODE_ENV = undefined
        return assert.equal(result, "filogic-site-prod-0306")
    });

    it('should test if the development mode work for the access token', async function () {
        tokenStub.restore()
        process.env.NODE_ENV = "local"
        let result = await index.getAccessToken()
        process.env.NODE_ENV = undefined
        return assert.equal(result, "token")
    });

    it('should fail to get a token', async function () {
        tokenStub.callsFake(()=>{})

        let result = await index.getAccessToken()

        return assert.equal(result, null)
    });

    it('should fail to get a project id', async function () {
        projectIdStub.callsFake(()=>{})

        let result = await index.getProjectId()

        return assert.equal(result, null)
    });

    it('should catch a error when failing the project id request', async function () {
        projectIdStub.restore()

        nock("http://metadata.google.internal").get("/computeMetadata/v1/project/project-id").replyWithError("Error to catch")

        let result = await index.getProjectId()

        return sinon.assert.calledWith(consoleLogStub, "error while fetching project id")
    });

    it('should catch a error when failing the project id request', async function () {
        tokenStub.restore()

        nock("http://metadata.google.internal").get("/computeMetadata/v1/instance/service-accounts/default/token?scopes=https://www.googleapis.com/auth/cloud-platform").replyWithError("Error to catch")

        let result = await index.getAccessToken()

        return sinon.assert.calledWith(consoleLogStub, "error while fetching ID token")
    });

    it('should delete multiple (2) tags form an image', async function () {
        let imageData = {
            imageSizeBytes: '451960514',
            layerId: '',
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            tag: ['19db44a6-f46c-41dc-8412-d412f03410b3_1', "tag_2"],
            timeCreatedMs: '315532801000',
            timeUploadedMs: '1673607900397',
            name: 'sha256:1430d0e8052f4733ac44d131968da44d813564fb46bc46cacb085108efbd7d4f_no_longer_valid',
            url: 'https://eu.gcr.io/v2/test_project_id/a'
        }

        for(let x=0; x<imageData.tag.length;x++){
            nock("https://eu.gcr.io").get('/v2/test_project_id/a/manifests/'+imageData.tag[x]).reply(200, "ok")
            nock("https://eu.gcr.io").delete('/v2/test_project_id/a/manifests/'+imageData.tag[x]).reply(200, "ok")
        }

        let response = await index.deleteTagsForImage(imageData)

        return assert.equal(response, 2)
    });

    it('should delete a (one) tag form an image', async function () {
        let imageData = {
            imageSizeBytes: '451960514',
            layerId: '',
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            tag: ['19db44a6-f46c-41dc-8412-d412f03410b3_1'],
            timeCreatedMs: '315532801000',
            timeUploadedMs: '1673607900397',
            name: 'sha256:1430d0e8052f4733ac44d131968da44d813564fb46bc46cacb085108efbd7d4f_no_longer_valid',
            url: 'https://eu.gcr.io/v2/test_project_id/a'
        }

        for(let x=0; x<imageData.tag.length;x++){
            nock("https://eu.gcr.io").get('/v2/test_project_id/a/manifests/'+imageData.tag[x]).reply(200, "ok")
            nock("https://eu.gcr.io").delete('/v2/test_project_id/a/manifests/'+imageData.tag[x]).reply(200, "ok")
        }

        let response = await index.deleteTagsForImage(imageData)

        return assert.equal(response, 1)
    });

    it('should get a 401 on tag delete and retry the tag delete with a new token', async function () {
        let imageData = {
            imageSizeBytes: '451960514',
            layerId: '',
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            tag: ['19db44a6-f46c-41dc-8412-d412f03410b3_1'],
            timeCreatedMs: '315532801000',
            timeUploadedMs: '1673607900397',
            name: 'sha256:1430d0e8052f4733ac44d131968da44d813564fb46bc46cacb085108efbd7d4f_no_longer_valid',
            url: 'https://eu.gcr.io/v2/test_project_id/a'
        }

        let tokenScope = nock("http://metadata.google.internal").get("/computeMetadata/v1/instance/service-accounts/default/token?scopes=https://www.googleapis.com/auth/cloud-platform").reply(200, {access_token:"test_access_token"})

        // first call return 401
        nock("https://eu.gcr.io").get('/v2/test_project_id/a/manifests/'+imageData.tag[0]).reply(401, "ok")
        nock("https://eu.gcr.io").delete('/v2/test_project_id/a/manifests/'+imageData.tag[0]).reply(401, "ok")

        // second call return 200
        nock("https://eu.gcr.io").get('/v2/test_project_id/a/manifests/'+imageData.tag[0]).reply(200, "ok")
        nock("https://eu.gcr.io").delete('/v2/test_project_id/a/manifests/'+imageData.tag[0]).reply(200, "ok")

        let response = await index.deleteTagsForImage(imageData)

        return assert.equal(response, 1, "Expected one image to be deleted") && assert.equal(tokenScope.isDone(), true, "No new token was requested")
    });

    it('should get a 401 on tag delete and retry the tag delete with a new token but still fail', async function () {
        let imageData = {
            imageSizeBytes: '451960514',
            layerId: '',
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            tag: ['19db44a6-f46c-41dc-8412-d412f03410b3_1'],
            timeCreatedMs: '315532801000',
            timeUploadedMs: '1673607900397',
            name: 'sha256:1430d0e8052f4733ac44d131968da44d813564fb46bc46cacb085108efbd7d4f_no_longer_valid',
            url: 'https://eu.gcr.io/v2/test_project_id/a'
        }

        let tokenScope = nock("http://metadata.google.internal").get("/computeMetadata/v1/instance/service-accounts/default/token?scopes=https://www.googleapis.com/auth/cloud-platform").reply(200, {access_token:"test_access_token"})

        nock("https://eu.gcr.io").get('/v2/test_project_id/a/manifests/'+imageData.tag[0]).twice().reply(401, "ok")
        nock("https://eu.gcr.io").delete('/v2/test_project_id/a/manifests/'+imageData.tag[0]).twice().reply(401, "ok")

        let response = await index.deleteTagsForImage(imageData)

        return assert.equal(response, 0, "Expected image tag to NOT be deleted") && assert.equal(tokenScope.isDone(), true, "No new token was requested")
    });

    it('should delete no tags form an image', async function () {
        let imageData = {
            imageSizeBytes: '451960514',
            layerId: '',
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            tag: ['19db44a6-f46c-41dc-8412-d412f03410b3_1'],
            timeCreatedMs: '315532801000',
            timeUploadedMs: '1673607900397',
            name: 'sha256:1430d0e8052f4733ac44d131968da44d813564fb46bc46cacb085108efbd7d4f_no_longer_valid',
            url: 'https://eu.gcr.io/v2/test_project_id/a'
        }

        for(let x=0; x<imageData.tag.length;x++){
            nock("https://eu.gcr.io").get('/v2/test_project_id/a/manifests/'+imageData.tag[x]).reply(403, "ok")
            nock("https://eu.gcr.io").delete('/v2/test_project_id/a/manifests/'+imageData.tag[x]).reply(403, "ok")
        }

        let response = await index.deleteTagsForImage(imageData)

        return assert.equal(response, 0)
    });

    it('should Delete a image form the repo list', async function () {
        let imageData = {
            imageSizeBytes: '451960514',
            layerId: '',
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            tag: ['19db44a6-f46c-41dc-8412-d412f03410b3'],
            timeCreatedMs: '315532801000',
            timeUploadedMs: '1673607900397',
            name: 'sha256:1430d0e8052f4733ac44d131968da44d813564fb46bc46cacb085108efbd7d4f_no_longer_valid',
            url: 'https://eu.gcr.io/v2/test_project_id/a'
        }

        nock("https://eu.gcr.io").get('/v2/test_project_id/a/manifests/'+imageData.name).reply(200, "ok")
        nock("https://eu.gcr.io").delete('/v2/test_project_id/a/manifests/'+imageData.name).reply(200, "ok")

        let response = await index.deleteImage(imageData)

        return assert.equal(response, 1)
    });

    it('should get a 401 on the delete and retry the delete with a new token', async function () {
        let imageData = {
            imageSizeBytes: '451960514',
            layerId: '',
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            tag: ['19db44a6-f46c-41dc-8412-d412f03410b3'],
            timeCreatedMs: '315532801000',
            timeUploadedMs: '1673607900397',
            name: 'sha256:1430d0e8052f4733ac44d131968da44d813564fb46bc46cacb085108efbd7d4f_no_longer_valid',
            url: 'https://eu.gcr.io/v2/test_project_id/a'
        }

        let tokenScope = nock("http://metadata.google.internal").get("/computeMetadata/v1/instance/service-accounts/default/token?scopes=https://www.googleapis.com/auth/cloud-platform").reply(200, {access_token:"test_access_token"})

        // first call return 401
        nock("https://eu.gcr.io").get('/v2/test_project_id/a/manifests/'+imageData.name).reply(401, "ok")
        nock("https://eu.gcr.io").delete('/v2/test_project_id/a/manifests/'+imageData.name).reply(401, "ok")
        // second call return 200
        nock("https://eu.gcr.io").get('/v2/test_project_id/a/manifests/'+imageData.name).reply(200, "ok")
        nock("https://eu.gcr.io").delete('/v2/test_project_id/a/manifests/'+imageData.name).reply(200, "ok")

        let response = await index.deleteImage(imageData)

        return assert.equal(response, 1, "Expected one image to be deleted") && assert.equal(tokenScope.isDone(), true, "No new token was requested")
    });

    it('should get a 401 on the delete and retry the delete but still fail', async function () {
        let imageData = {
            imageSizeBytes: '451960514',
            layerId: '',
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            tag: ['19db44a6-f46c-41dc-8412-d412f03410b3'],
            timeCreatedMs: '315532801000',
            timeUploadedMs: '1673607900397',
            name: 'sha256:1430d0e8052f4733ac44d131968da44d813564fb46bc46cacb085108efbd7d4f_no_longer_valid',
            url: 'https://eu.gcr.io/v2/test_project_id/a'
        }

        let tokenScope = nock("http://metadata.google.internal").get("/computeMetadata/v1/instance/service-accounts/default/token?scopes=https://www.googleapis.com/auth/cloud-platform").reply(200, {access_token:"test_access_token"})

        nock("https://eu.gcr.io").get('/v2/test_project_id/a/manifests/'+imageData.name).twice().reply(401, "ok")
        nock("https://eu.gcr.io").delete('/v2/test_project_id/a/manifests/'+imageData.name).twice().reply(401, "ok")

        let response = await index.deleteImage(imageData)

        return assert.equal(response, 0, "Expected image to NOT be deleted") && assert.equal(tokenScope.isDone(), true, "No new token was requested")
    });

    it('should not delete a image form the repo list', async function () {
        let imageData = {
            imageSizeBytes: '451960514',
            layerId: '',
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            tag: ['19db44a6-f46c-41dc-8412-d412f03410b3'],
            timeCreatedMs: '315532801000',
            timeUploadedMs: '1673607900397',
            name: 'sha256:1430d0e8052f4733ac44d131968da44d813564fb46bc46cacb085108efbd7d4f_no_longer_valid',
            url: 'https://eu.gcr.io/v2/test_project_id/a'
        }

        nock("https://eu.gcr.io").get('/v2/test_project_id/a/manifests/'+imageData.name).reply(403, "ok")
        nock("https://eu.gcr.io").delete('/v2/test_project_id/a/manifests/'+imageData.name).reply(403, "ok")

        let response = await index.deleteImage(imageData)

        return assert.equal(response, 0)
    });

    it('should return an empty list without errors', function () {
        let list = {'a':[1,2,3], 'b':[]}

        index.removeImagesToBeKeptFromImageList(list)

        let actual = {'a':[], 'b':[]}

        return assert.deepStrictEqual(list, actual)
    });

    it('should return an empty list', function () {
        let list = {'a':[1,2,3,4,5], 'b':[1,2,3,4,5]}

        index.removeImagesToBeKeptFromImageList(list)

        let actual = {'a':[], 'b':[]}

        return assert.deepStrictEqual(list, actual)
    });

    it('should remove the last 5 items of the list', function () {
        let list = {'a':[1,2,3,4,5,6,7,8,9,10], 'b':[1,2,3,4,5,6,7,8,9,10]}

        index.removeImagesToBeKeptFromImageList(list)

        let actual = {'a':[1,2,3,4,5], 'b':[1,2,3,4,5]}

        return assert.deepStrictEqual(list, actual)
    });

    it('should sort the image list by oldest first', function () {
        let date = new Date()
        
        let imageList = {
            'a' : [
                {
                    timeUploadedMs: new Date(date-7),
                    name: 'lastWeek',
                },
                {
                    timeUploadedMs: new Date(date-1),
                    name: 'yesterday',
                },
                {
                    timeUploadedMs: new Date(date-30),
                    name: 'lastMonth',
                },
                {
                    timeUploadedMs: new Date(date),
                    name: 'now',
                },
                {
                    timeUploadedMs: new Date(date-10),
                    name: 'now-10',
                },
            ],
            'b' : [
                {
                    timeUploadedMs: new Date(date - 1),
                    name: 'yesterday',
                },
                {
                    timeUploadedMs: new Date(date - 30),
                    name: 'lastMonth',
                },
                {
                    timeUploadedMs: new Date(date - 7),
                    name: 'lastWeek',
                },
                {
                    timeUploadedMs: new Date(date - 10),
                    name: 'now-10',
                },
                {
                    timeUploadedMs: new Date(date),
                    name: 'now',
                },
            ]
        }

        index.sortImageList(imageList)

        return assert.deepStrictEqual(imageList, {
            'a' : [
                {
                    timeUploadedMs: new Date(date-30),
                    name: 'lastMonth',
                },
                {
                    timeUploadedMs: new Date(date-10),
                    name: 'now-10',
                },
                {
                    timeUploadedMs: new Date(date-7),
                    name: 'lastWeek',
                },
                {
                    timeUploadedMs: new Date(date-1),
                    name: 'yesterday',
                },
                {
                    timeUploadedMs: new Date(date),
                    name: 'now',
                },
            ],
            'b' : [
                {
                    timeUploadedMs: new Date(date-30),
                    name: 'lastMonth',
                },
                {
                    timeUploadedMs: new Date(date-10),
                    name: 'now-10',
                },
                {
                    timeUploadedMs: new Date(date-7),
                    name: 'lastWeek',
                },
                {
                    timeUploadedMs: new Date(date-1),
                    name: 'yesterday',
                },
                {
                    timeUploadedMs: new Date(date),
                    name: 'now',
                },
            ]
        })
    });

    it('should get the total image count in the repository list', async function () {
        let imageList = {
            'https://eu.gcr.io/v2/test_project_id/a' : [
                {
                    imageSizeBytes: '451960514',
                    layerId: '',
                    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
                    tag: [Array],
                    timeCreatedMs: '315532801000',
                    timeUploadedMs: '1673607900397',
                    name: 'sha256:1430d0e8052f4733ac44d131968da44d813564fb46bc46cacb085108efbd7d4f',
                    url: 'https://eu.gcr.io/v2/test_project_id/a'
                },
                {
                    imageSizeBytes: '381549283',
                    layerId: '',
                    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
                    tag: [Array],
                    timeCreatedMs: '315532801000',
                    timeUploadedMs: '1674716827668',
                    name: 'sha256:89a657b572a4d12f84253f82fd7b093fa57dc41a1e635999b82685c301e9e83a',
                    url: 'https://eu.gcr.io/v2/test_project_id/a'
                }
            ],
            'https://eu.gcr.io/v2/test_project_id/b' : [
                {
                    imageSizeBytes: '',
                    layerId: '',
                    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
                    tag: [Array],
                    timeCreatedMs: '315532801000',
                    timeUploadedMs: '1673607900397',
                    name: 'sha256:test',
                    url: 'https://eu.gcr.io/v2/test_project_id/b'
                },
                {
                    imageSizeBytes: '381549283',
                    layerId: '',
                    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
                    tag: [Array],
                    timeCreatedMs: '315532801000',
                    timeUploadedMs: '1674716827668',
                    name: 'sha256:test2',
                    url: 'https://eu.gcr.io/v2/test_project_id/b'
                }
            ]
        }

        let count = index.getTotalImageCount(imageList)

        return assert.equal(count, 4)
    });

    it('should get no repository image lists back because the project id do not match', async function () {
        let repositories = [
            "https://eu.gcr.io/v2/different_project_id/b",
        ]

        let responseB = {
            "child": [],
            "manifest": {
                "sha256:test": {
                    "imageSizeBytes": "",
                    "layerId": "",
                    "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
                    "tag": ["19db44a6-f46c-41dc-8412-d412f03410b3"],
                    "timeCreatedMs": "315532801000",
                    "timeUploadedMs": "1673607900397"
                },
            },
            "name": "b",
            "tags": ["19db44a6-f46c-41dc-8412-d412f03410b3", "2275b8b0-fbd9-4622-8b4e-4e08b4625ce9", "latest"]
        }

        nock("https://eu.gcr.io").get("/v2/different_project_id/b/tags/list").reply(200, responseB)

        let imageList = await index.getGCRImageListPerRepo(repositories, "test_project_id")

        return assert.deepEqual(imageList, [])
    });

    it('should get only on of the two requested repository images lists back', async function () {
        let repositories = [
            "https://eu.gcr.io/v2/test_project_id/a",
            "https://eu.gcr.io/v2/different_project_id/b",
        ]

        let responseA = {
            "child": [],
            "manifest": {
                "sha256:1430d0e8052f4733ac44d131968da44d813564fb46bc46cacb085108efbd7d4f": {
                    "imageSizeBytes": "451960514",
                    "layerId": "",
                    "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
                    "tag": ["19db44a6-f46c-41dc-8412-d412f03410b3"],
                    "timeCreatedMs": "315532801000",
                    "timeUploadedMs": "1673607900397"
                },
            },
            "name": "a",
            "tags": ["19db44a6-f46c-41dc-8412-d412f03410b3", "2275b8b0-fbd9-4622-8b4e-4e08b4625ce9", "latest"]
        }
        let responseB = {
            "child": [],
            "manifest": {
                "sha256:test": {
                    "imageSizeBytes": "",
                    "layerId": "",
                    "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
                    "tag": ["19db44a6-f46c-41dc-8412-d412f03410b3"],
                    "timeCreatedMs": "315532801000",
                    "timeUploadedMs": "1673607900397"
                },
            },
            "name": "b",
            "tags": ["19db44a6-f46c-41dc-8412-d412f03410b3", "2275b8b0-fbd9-4622-8b4e-4e08b4625ce9", "latest"]
        }

        nock("https://eu.gcr.io").get("/v2/test_project_id/a/tags/list").reply(200, responseA)
        nock("https://eu.gcr.io").get("/v2/different_project_id/b/tags/list").reply(200, responseB)

        let imageList = await index.getGCRImageListPerRepo(repositories, "test_project_id")

        let expected = []
        expected["https://eu.gcr.io/v2/test_project_id/a"] = [{
            imageSizeBytes: '451960514',
            layerId: '',
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            tag: ['19db44a6-f46c-41dc-8412-d412f03410b3'],
            timeCreatedMs: '315532801000',
            timeUploadedMs: '1673607900397',
            name: 'sha256:1430d0e8052f4733ac44d131968da44d813564fb46bc46cacb085108efbd7d4f',
            url: 'https://eu.gcr.io/v2/test_project_id/a'
        }]

        return assert.deepEqual(imageList, expected)
    });

    it('should get the list of images for multiple repositories', async function () {
        let repositories = [
            "https://eu.gcr.io/v2/test_project_id/a",
            "https://eu.gcr.io/v2/test_project_id/b",
        ]

        let responseA = {
            "child": [],
            "manifest": {
                "sha256:1430d0e8052f4733ac44d131968da44d813564fb46bc46cacb085108efbd7d4f": {
                    "imageSizeBytes": "451960514",
                    "layerId": "",
                    "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
                    "tag": ["19db44a6-f46c-41dc-8412-d412f03410b3"],
                    "timeCreatedMs": "315532801000",
                    "timeUploadedMs": "1673607900397"
                },
                "sha256:89a657b572a4d12f84253f82fd7b093fa57dc41a1e635999b82685c301e9e83a": {
                    "imageSizeBytes": "381549283",
                    "layerId": "",
                    "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
                    "tag": ["674306a5-0cf6-403f-a788-874c751d9b94"],
                    "timeCreatedMs": "315532801000",
                    "timeUploadedMs": "1674716827668"
                },
            },
            "name": "a",
            "tags": ["19db44a6-f46c-41dc-8412-d412f03410b3", "2275b8b0-fbd9-4622-8b4e-4e08b4625ce9", "latest"]
        }
        let responseB = {
            "child": [],
            "manifest": {
                "sha256:test": {
                    "imageSizeBytes": "",
                    "layerId": "",
                    "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
                    "tag": ["19db44a6-f46c-41dc-8412-d412f03410b3"],
                    "timeCreatedMs": "315532801000",
                    "timeUploadedMs": "1673607900397"
                },
                "sha256:test2": {
                    "imageSizeBytes": "381549283",
                    "layerId": "",
                    "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
                    "tag": ["674306a5-0cf6-403f-a788-874c751d9b94"],
                    "timeCreatedMs": "315532801000",
                    "timeUploadedMs": "1674716827668"
                },
            },
            "name": "b",
            "tags": ["19db44a6-f46c-41dc-8412-d412f03410b3", "2275b8b0-fbd9-4622-8b4e-4e08b4625ce9", "latest"]
        }

        nock("https://eu.gcr.io").get("/v2/test_project_id/a/tags/list").reply(200, responseA)
        nock("https://eu.gcr.io").get("/v2/test_project_id/b/tags/list").reply(200, responseB)

        let imageList = await index.getGCRImageListPerRepo(repositories, "test_project_id")

        let expected = []
        expected['https://eu.gcr.io/v2/test_project_id/a'] = [
            {
                imageSizeBytes: '451960514',
                layerId: '',
                mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
                tag: ['19db44a6-f46c-41dc-8412-d412f03410b3'],
                timeCreatedMs: '315532801000',
                timeUploadedMs: '1673607900397',
                name: 'sha256:1430d0e8052f4733ac44d131968da44d813564fb46bc46cacb085108efbd7d4f',
                url: 'https://eu.gcr.io/v2/test_project_id/a'
            },
            {
                imageSizeBytes: '381549283',
                layerId: '',
                mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
                tag: ['674306a5-0cf6-403f-a788-874c751d9b94'],
                timeCreatedMs: '315532801000',
                timeUploadedMs: '1674716827668',
                name: 'sha256:89a657b572a4d12f84253f82fd7b093fa57dc41a1e635999b82685c301e9e83a',
                url: 'https://eu.gcr.io/v2/test_project_id/a'
            }
        ]
        expected['https://eu.gcr.io/v2/test_project_id/b'] = [
            {
                imageSizeBytes: '',
                layerId: '',
                mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
                tag: ['19db44a6-f46c-41dc-8412-d412f03410b3'],
                timeCreatedMs: '315532801000',
                timeUploadedMs: '1673607900397',
                name: 'sha256:test',
                url: 'https://eu.gcr.io/v2/test_project_id/b'
            },
            {
                imageSizeBytes: '381549283',
                layerId: '',
                mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
                tag: ['674306a5-0cf6-403f-a788-874c751d9b94'],
                timeCreatedMs: '315532801000',
                timeUploadedMs: '1674716827668',
                name: 'sha256:test2',
                url: 'https://eu.gcr.io/v2/test_project_id/b'
            }
        ]

        return assert.deepStrictEqual(imageList, expected)
    });

    it('should should convert the repo name to a url', function () {
        let url = index.convertRepoNameToUrlBasedRepoName("test_repo", "https://test.test")

        return url === "https://test.test/test_repo"
    });

    it('should get the request header', async function () {
        let header = index.getRequestHeader()

        return header === {
            "Authorization": "Bearer test_access_token",
        }
    });

    it('should get the repository lit of 1 source', async function () {
        nock("https://test.gcr.io").get("/_catalog").reply(200, {repositories: ['agile-analytics-cloud-a65f/next-agileanalytics', 'agile-analytics-cloud-a65f/strapi-agileanalytics']})

        let repositories = await index.getGCRRepositories(["https://test.gcr.io"])

        return assert.deepStrictEqual(repositories, [
            'https://test.gcr.io/agile-analytics-cloud-a65f/next-agileanalytics',
            'https://test.gcr.io/agile-analytics-cloud-a65f/strapi-agileanalytics',
        ])
    });

    it('should get the repository list of 2 sources', async function () {
        // fetchStub.onCall(0).returns({"repositories":['agile-analytics-cloud-a65f/next-agileanalytics','agile-analytics-cloud-a65f/strapi-agileanalytics']})
        // fetchStub.onCall(1).returns({"repositories":['filogic-site-prod-0306/filogic-nl','terraform-seed-project-276118/wordpress-zen']})

        // fetchMock.get("https://test.gcr.io/_catalog", "{repositories:['agile-analytics-cloud-a65f/next-agileanalytics','agile-analytics-cloud-a65f/strapi-agileanalytics']}")
        // fetchMock.get("https://test2.gcr.io/_catalog", "{repositories:['filogic-site-prod-0306/filogic-nl','terraform-seed-project-276118/wordpress-zen']}")

        nock("https://test.gcr.io").get("/_catalog").reply(200, {repositories: ['agile-analytics-cloud-a65f/next-agileanalytics', 'agile-analytics-cloud-a65f/strapi-agileanalytics']})
        nock("https://test2.gcr.io").get("/_catalog").reply(200, {repositories: ['filogic-site-prod-0306/filogic-nl', 'terraform-seed-project-276118/wordpress-zen']})


        let repositories = await index.getGCRRepositories(["https://test.gcr.io", "https://test2.gcr.io"])

        return assert.deepStrictEqual(repositories, [
            'https://test.gcr.io/agile-analytics-cloud-a65f/next-agileanalytics',
            'https://test.gcr.io/agile-analytics-cloud-a65f/strapi-agileanalytics',
            'https://test2.gcr.io/filogic-site-prod-0306/filogic-nl',
            'https://test2.gcr.io/terraform-seed-project-276118/wordpress-zen'
        ])
    });

    it('should get fake access token', async function () {
        let token = await index.getAccessToken()

        return assert.deepEqual(token, "test_access_token")
    });

    it('should get fake project id', async function () {
        let projectId = await index.getProjectId()

        return assert.equal(projectId, "test_project_id")
    });

    function prepareAllNock(){
        let response = {
            "child": [],
            "manifest": {},
            "name": "a",
            "tags": ["19db44a6-f46c-41dc-8412-d412f03410b3", "2275b8b0-fbd9-4622-8b4e-4e08b4625ce9", "test_tag", "latest"]
        }
        for (let x=0;x<7;x++){
            let char = String.fromCharCode(x+97)

            response.manifest[char] = {
                "imageSizeBytes": "451960514",
                "layerId": "",
                "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
                "tag": ["19db44a6-f46c-41dc-8412-d412f03410b3", "test_tag"],
                "timeCreatedMs": "315532801000",
                "timeUploadedMs": "1673607900397"
            }
        }
        nock("http://metadata.google.internal").get("/computeMetadata/v1/instance/service-accounts/default/token?scopes=https://www.googleapis.com/auth/cloud-platform").reply(200, {access_token:"test_access_token"})
        nock("http://metadata.google.internal").get("/computeMetadata/v1/project/project-id").reply(200, "test_project_id")
        nock('https://gcr.io/v2').get("/_catalog").reply(200, {repositories: ['test_project_id/next-agileanalytics', 'test_project_id/strapi-agileanalytics']})
        nock('https://eu.gcr.io/v2').get("/_catalog").reply(200, {repositories: ['filogic-site-prod-0306/filogic-nl', 'test_project_id/wordpress-zen']})
        nock("https://gcr.io").get("/v2/test_project_id/next-agileanalytics/tags/list").reply(200, response)
        nock("https://gcr.io").get("/v2/test_project_id/strapi-agileanalytics/tags/list").reply(200, response)
        nock("https://eu.gcr.io").get("/v2/test_project_id/wordpress-zen/tags/list").reply(200, response)
        nock("https://gcr.io").persist().get(uri => uri.includes("test_project_id") && uri.includes("/manifests/")).reply(200, {})
        nock("https://gcr.io").persist().delete(uri => uri.includes("test_project_id") && uri.includes("/manifests/")).reply(200, {})
        nock("https://eu.gcr.io").persist().get(uri => uri.includes("test_project_id") && uri.includes("/manifests/")).reply(200, {})
        nock("https://eu.gcr.io").persist().delete(uri => uri.includes("test_project_id") && uri.includes("/manifests/")).reply(200, {})
    }

    it('should report the amount of deleted tags and images', async function () {
        prepareAllNock()

        let result = await index.manageContainerRegistryImages()

        return assert.deepStrictEqual(result, [12,6,6])
    });

    it('should handle the request and return a status message of the results', async function () {
        prepareAllNock()

        const server = getTestServer("manageContainerRegistryImages")
        await supertest(server)
            .get("/manageContainerRegistryImages")
            .expect(200)
            .expect("Finished managing container images. Deleted 6/6 (100.00%). Also deleted 12 tags.")

        nock.restore()
    });
})