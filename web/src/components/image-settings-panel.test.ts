import assert from "node:assert/strict";
import { imageSizeLabel, __test__ } from "./image-settings-panel";

const expectedAspectOptions = [
    ["1:1", "1:1", 1024, 1024],
    ["3:2", "3:2", 1536, 1024],
    ["2:3", "2:3", 1024, 1536],
    ["4:3", "4:3", 1152, 864],
    ["3:4", "3:4", 864, 1152],
    ["5:4", "5:4", 1120, 896],
    ["4:5", "4:5", 896, 1120],
    ["16:9", "16:9", 1280, 720],
    ["9:16", "9:16", 720, 1280],
    ["21:9", "21:9", 1456, 624],
    ["1:1-2k", "1:1(2K)", 2048, 2048],
    ["3:2-2k", "3:2(2K)", 2496, 1664],
    ["2:3-2k", "2:3(2K)", 1664, 2496],
    ["4:3-2k", "4:3(2K)", 2304, 1728],
    ["3:4-2k", "3:4(2K)", 1728, 2304],
    ["5:4-2k", "5:4(2K)", 2240, 1792],
    ["4:5-2k", "4:5(2K)", 1792, 2240],
    ["16:9-2k", "16:9(2K)", 2560, 1440],
    ["9:16-2k", "9:16(2K)", 1440, 2560],
    ["21:9-2k", "21:9(2K)", 3024, 1296],
    ["auto", "auto", 0, 0],
] as const;

assert.deepEqual(
    __test__.aspectOptions.map((item) => [item.value, item.label, item.width, item.height]),
    expectedAspectOptions,
    "image settings should expose the new 1K and 2K gpt-image ratio presets without 4K explicit ratio buttons",
);

for (const [value, label] of expectedAspectOptions) {
    assert.equal(imageSizeLabel(value), label);
}

assert.deepEqual(__test__.readSizeDimensions("16:9", __test__.aspectOptions.find((item) => item.value === "16:9")!), { width: 1280, height: 720 });
assert.deepEqual(__test__.readSizeDimensions("4:3", __test__.aspectOptions.find((item) => item.value === "4:3")!), { width: 1152, height: 864 });
assert.equal(__test__.alignDimension(721, true), 736);
assert.equal(__test__.alignDimension(721, false), 721);

assert.deepEqual(__test__.settingsForModel("gpt-image-2-lite").qualityOptions, [{ value: "low", label: "1K" }]);
assert.equal(__test__.settingsForModel("gpt-image-2-lite").aspectOptions.length, 10, "lite should only expose 1K ratios");
assert.deepEqual(
    __test__.settingsForModel("default::gpt-image-2-pro").qualityOptions.map((item) => item.label),
    ["1K", "2K", "4K"],
    "pro should expose all supported resolutions",
);
assert.equal(__test__.settingsForModel("gpt-image-2-pro").aspectOptions.length, 10, "pro resolution should be selected separately from ratio");
assert.equal(__test__.effectiveImageQuality("gpt-image-2-lite", "high"), "low");
