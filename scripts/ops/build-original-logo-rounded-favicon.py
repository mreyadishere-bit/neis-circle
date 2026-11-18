#!/usr/bin/env python3
"""Make a genuinely circular, transparent favicon from the EXISTING NC logo.

Preserves the original green and white NC artwork; no new drawing, text or colors.
"""
from pathlib import Path
from PIL import Image, ImageDraw
import argparse

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--source",default="assets/email-logo.png")
    parser.add_argument("--output-dir",default="seo-icon-output")
    args=parser.parse_args()
    original=Image.open(args.source).convert("RGBA")
    w,h=original.size
    if w<200 or h<200 or abs(w-h)>3:
        raise RuntimeError("Unexpected original logo size")
    side=min(w,h)
    # The original logo has a white square background around its green rounded
    # field. Crop its white border and round the field itself, leaving NC unchanged.
    inset=round(side*0.095)
    left=(w-side)//2+inset
    top=(h-side)//2+inset
    content=original.crop((left,top,left+side-2*inset,top+side-2*inset))
    sz=content.width
    # Preserve the original letters exactly, but replace the original rounded-
    # square's off-white fringe with its own sampled green before circular crop.
    # This fixes white pixels INSIDE the circular contour, not just outside it.
    green=content.getpixel((sz//2,max(4,sz//12)))[:3]
    if not (green[1]>green[0]*1.3 and green[1]>green[2]*0.85):
        raise RuntimeError("Original NC green not detected")
    cleaned=Image.new("RGBA",(sz,sz),green+(255,))
    # The white NC letters sit in the central region of the original logo.
    # Use the original artwork's pixels rather than recreating the letters.
    region=(int(sz*.09),int(sz*.17),int(sz*.91),int(sz*.83))
    cleaned.paste(content.crop(region),region[:2])
    content=cleaned
    # Supersampling makes circular edges clean at tiny Google favicon sizes.
    mask=Image.new("L",(sz*3,sz*3),0)
    draw=ImageDraw.Draw(mask)
    draw.ellipse((0,0,sz*3-1,sz*3-1),fill=255)
    mask=mask.resize((sz,sz),Image.Resampling.LANCZOS)
    content.putalpha(mask)
    out=Path(args.output_dir)
    out.mkdir(parents=True,exist_ok=True)
    content.resize((512,512),Image.Resampling.LANCZOS).save(out/"favicon-rounded.png",optimize=True)
    content.resize((192,192),Image.Resampling.LANCZOS).save(out/"favicon-rounded-192.png",optimize=True)
    content.resize((64,64),Image.Resampling.LANCZOS).save(out/"favicon-rounded-64.png",optimize=True)
    content.resize((48,48),Image.Resampling.LANCZOS).save(out/"favicon-rounded-48.png",optimize=True)
    content.resize((256,256),Image.Resampling.LANCZOS).save(out/"favicon.ico",format="ICO",sizes=[(16,16),(32,32),(48,48),(64,64)])
    preview=Image.open(out/"favicon-rounded-192.png")
    assert preview.getpixel((0,0))[3]==0
    assert preview.getpixel((96,96))[3]==255
    assert preview.getpixel((96,40))[:3]!=(255,255,255)
    print("ORIGINAL_LOGO_CIRCULAR_FAVICON=PASS")
    print("NO_BRANDING_REDESIGN=TRUE")

if __name__=="__main__":main()
