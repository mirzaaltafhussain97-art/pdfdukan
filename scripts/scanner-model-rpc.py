"""Offline corner-model inference for source tests; accepts only 256px RGBA tensors."""
from pathlib import Path
import sys,json,base64
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'output/handwriting-model-20261103/python-lib'))
import numpy as np
import onnxruntime as ort
options=ort.SessionOptions();options.intra_op_num_threads=2
session=ort.InferenceSession(str(ROOT/'public/models/docaligner.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
names=[n.name for n in session.get_outputs()]
for line in sys.stdin:
 try:
  row=json.loads(line);pixels=np.frombuffer(base64.b64decode(row['rgba']),dtype=np.uint8).reshape(256,256,4)
  tensor=np.transpose(pixels[:,:,[2,1,0]].astype(np.float32)/255,(2,0,1))[None].copy()
  result=dict(zip(names,session.run(None,{'img':tensor})))
  points=result['points'].reshape(-1).tolist() if float(result['has_obj'].reshape(-1)[0])>.5 else None
  print(json.dumps({'id':row['id'],'points':points}),flush=True)
 except Exception as error:print(json.dumps({'error':str(error)}),flush=True)
