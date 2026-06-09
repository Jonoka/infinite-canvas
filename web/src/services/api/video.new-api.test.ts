import { strict as assert } from "node:assert";

import { __test__ } from "./video";

const baseConfig = { videoSeconds: "8", size: "1280x720", vquality: "720", videoReferenceMode: "image" };
const firstLastConfig = { ...baseConfig, videoReferenceMode: "first_last_frame" };
const file = new File([new Blob(["x"], { type: "image/png" })], "ref.png", { type: "image/png" });
const file2 = new File([new Blob(["y"], { type: "image/png" })], "ref2.png", { type: "image/png" });

const textToVideo = __test__.buildOpenAIVideoFormData(baseConfig as never, "veo3.1-pro", "prompt", []);
assert.equal(textToVideo.get("type"), "1");
assert.equal(textToVideo.has("reference_mode"), false);
assert.equal(textToVideo.get("seconds"), "8");
assert.equal(textToVideo.get("size"), "1280x720");
assert.equal(textToVideo.get("resolution_name"), "720p");
assert.equal(textToVideo.get("preset"), "normal");

const imageToVideo = __test__.buildOpenAIVideoFormData(baseConfig as never, "veo3.1-pro", "prompt", [file, file2]);
assert.equal(imageToVideo.get("type"), "2");
assert.equal(imageToVideo.get("reference_mode"), "image");
assert.equal(imageToVideo.getAll("input_reference[]").length, 2);
assert.equal(imageToVideo.has("first_frame"), false);
assert.equal(imageToVideo.has("last_frame"), false);

const firstLast = __test__.buildOpenAIVideoFormData(firstLastConfig as never, "veo3.1-pro", "prompt", [file, file2]);
assert.equal(firstLast.get("type"), "2");
assert.equal(firstLast.get("reference_mode"), "first_last_frame");
assert.equal((firstLast.get("first_frame") as File).name, "ref.png");
assert.equal((firstLast.get("last_frame") as File).name, "ref2.png");
assert.equal(firstLast.getAll("input_reference[]").length, 0);

const components = __test__.buildOpenAIVideoFormData(firstLastConfig as never, "veo3.1-components", "prompt", [file, file2]);
assert.equal(components.get("type"), "3");
assert.equal(components.get("reference_mode"), "components");
assert.equal(components.getAll("input_reference[]").length, 2);
assert.equal(components.has("first_frame"), false);
assert.equal(components.has("last_frame"), false);
