#!/usr/bin/env python3
"""Prepare WhatsApp-friendly JPEG OG images and exact original hash redirects.

Uses the approved 15 illustrations in the user's existing source ZIP. No crop,
no stretch: the existing proportional share-image builder handles the canvas.
Existing website visuals and home image are not changed.
"""
from pathlib import Path
from PIL import Image
import argparse,json,runpy

SITE="https://neiscircle.site"
VERSION="20261119-whatsapp-jpeg"
HERE=Path(__file__).resolve().parent
PREVIOUS=runpy.run_path(str(HERE/"build-clean-hash-previews-20261119.py"))
ARTWORK=PREVIOUS["ARTWORK"]
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--assets-dir",required=True)
 p.add_argument("--output-dir",required=True)
 args=p.parse_args()
 source=Path(args.assets_dir)
 out=Path(args.output_dir)
 mapping={}
 for slug,(w,h,title,description) in ARTWORK.items():
  original=source/(slug+".webp")
  webp=out/"intermediate"/(slug+".webp")
  jpeg=out/"images"/(slug+".jpg")
  html_file=out/"html"/(slug+".html")
  corrected=PREVIOUS["build_image"](original,webp,w,h)
  jpeg.parent.mkdir(parents=True,exist_ok=True)
  with Image.open(webp) as im:
   photo=im.convert("RGB")
   for quality in (90,86,82,78,74,70):
    photo.save(jpeg,format="JPEG",quality=quality,optimize=True,progressive=True,subsampling=0)
    if jpeg.stat().st_size<=340000:break
  if jpeg.stat().st_size>340000:
   raise RuntimeError("OG preview JPEG exceeds safe size for "+slug)
  with Image.open(jpeg) as check:
   assert check.format=="JPEG" and check.size==(1200,630)
  PREVIOUS["build_html"](slug,title,description,html_file)
  page=html_file.read_text()
  old_src=SITE+"/assets/share-link/"+slug+".webp?v=20261119-proportions"
  new_src=SITE+"/assets/share-link/"+slug+".jpg?v="+VERSION
  assert page.count(old_src)>=2,slug
  page=page.replace(old_src,new_src)
  assert '<meta property="og:image:type" content="image/webp">' in page
  page=page.replace('content="image/webp"','content="image/jpeg"')
  old_redirect="window.location.replace('/'+window.location.search+'#/"+slug+"');"
  new_redirect="window.location.replace('/#/"+slug+"');"
  if old_redirect not in page:raise RuntimeError("Unexpected redirect in "+slug)
  page=page.replace(old_redirect,new_redirect)
  assert old_redirect not in page
  assert '<meta property="og:url" content="'+SITE+'/'+slug+'">' in page
  assert '<meta property="og:image" content="'+new_src+'">' in page
  html_file.write_text(page,encoding="utf8")
  mapping[slug]={"share_url":SITE+"/"+slug,
                 "fresh_test_url":SITE+"/"+slug+"?preview="+VERSION,
                 "app_destination":SITE+"/#/"+slug,
                 "og_image":new_src,"image_bytes":jpeg.stat().st_size,
                 "original_aspect_ratio":str(w)+":"+str(h),
                 "restored_inner_width":corrected}
 (out/"mapping.json").write_text(json.dumps(mapping,indent=2),encoding="utf8")
 print("WHATSAPP_JPEG_META_PAGES=15")
 print("NONSTRETCHED_APPROVED_ARTWORK=YES")
 print("HASH_REDIRECT_WITHOUT_QUERY=YES")
if __name__=="__main__":main()
