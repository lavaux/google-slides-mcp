# Crop images locally with sharp

The Slides API reports an image's crop in `cropProperties` but treats it as read-only, so no request can crop an image. Cropping is therefore done on the pixels, here, and the result goes through the Drive staging path of ADR-0011. `crop_image` crops an image already in the deck, and `insert_image` and `replace_image` take an optional crop.

The crop is a box in source pixels with its origin at the top-left. The Slides API reports frames in points and never reports pixels, so `get_image_info` reads the pixel size, and a box that runs past the image is refused with the real size in the message.

We use `sharp`. It decodes and re-encodes PNG, JPEG and GIF in one dependency, keeps an animated GIF's frames when cropping, and ships prebuilt binaries. The repo already carries one native module. PNG and GIF stay lossless and JPEG is written at quality 92.

A cropped `imageUrl` is downloaded and staged instead of being passed through to Google, since Google can only fetch the original. A deck image is downloaded from its `contentUrl`, which is short-lived and tagged with the requester's account, so it needs no credentials. The smoke test shows that `contentUrl` serves the current pixels after a replacement.

`crop_image` keeps the retained pixels where they were and at the same scale, as a crop in the editor does. The frame shrinks by the kept fraction on each axis, and its anchor moves along the element's own axes, so rotation is respected. `replaceImage` re-derives the intrinsic size from the new pixels and refits them to their own aspect ratio inside the old frame. On a stretched image that refit would un-stretch and re-centre the crop. The pixels are therefore swapped in one batch, the stored size is read back, and the frame is written in a second batch.

An image that already carries an editor crop is refused. Its `contentUrl` pixels and its crop would combine in ways the API cannot express, and the crop cannot be cleared through the API.
