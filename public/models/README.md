# Models folder

Drop the DocAligner ONNX model here as:

    docaligner.onnx

This file powers AI-based document corner detection in the scanner.
It is loaded by `public/js/crop.js` via onnxruntime-web.

See the setup guide (steps 1–5) for how to obtain this file.
The scanner falls back to the existing 4-method OpenCV detection if
this file is missing, so nothing breaks without it.
