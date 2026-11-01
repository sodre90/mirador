import { describe, expect, test } from "bun:test";
import { imagesToPaste, nextNumber, referencedAttachments, restoredDraft, withoutPlaceholder } from "../web/pasted-images.ts";

const one = { number: 1, imageId: "first.png" };
const two = { number: 2, imageId: "second.png" };

describe("pasted images", () => {
  test("only the images the text still mentions go with it, in the order it mentions them", () => {
    expect(referencedAttachments("compare [Image #2] with [Image #1]", [one, two])).toEqual([two, one]);
    expect(referencedAttachments("just [Image #2]", [one, two])).toEqual([two]);
    expect(referencedAttachments("[Image #12]", [one])).toEqual([]);
  });

  test("a screenshot or a copied image file pastes as an image, but copied cells or rich text paste as text", () => {
    const screenshot = new File(["png"], "image.png", { type: "image/png" });
    const copiedFile = new File(["png"], "Screenshot 2026-10-01.png", { type: "image/png" });
    expect(imagesToPaste("", [screenshot])).toEqual([screenshot]);
    expect(imagesToPaste("Screenshot 2026-10-01.png", [copiedFile])).toEqual([copiedFile]);
    expect(imagesToPaste("A1\tB1\n", [screenshot])).toEqual([]);
  });

  test("numbers continue after the highest one in the box", () => {
    expect(nextNumber([])).toBe(1);
    expect(nextNumber([2, 1])).toBe(3);
  });

  test("removing an image takes its placeholder out of the text", () => {
    expect(withoutPlaceholder("look [Image #1] here [Image #2] ", 1)).toBe("look here [Image #2] ");
  });

  test("a queued message comes back with its images, renumbered after the ones already in the box", () => {
    expect(restoredDraft("compare [Image #1] and [Image #2], again [Image #1]", ["a.png", "b.png"], [one, two])).toEqual({
      text: "compare [Image #3] and [Image #4], again [Image #3]",
      attachments: [
        { number: 3, imageId: "a.png" },
        { number: 4, imageId: "b.png" },
      ],
    });
    expect(restoredDraft("no images", [], [one])).toEqual({ text: "no images", attachments: [] });
  });
});
