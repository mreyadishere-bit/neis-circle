/* NEIS Circle Gallery refresh — isolated presentation/upload layer.
   Keeps the existing gallery_items table, storage bucket, moderation and resource loader. */
(function(){
  'use strict';
  if(window.__neisPinterestGalleryV1)return;
  window.__neisPinterestGalleryV1=true;

  const MAX_FILES=20;
  const MAX_BYTES=8*1024*1024;
  const t=(en,ar)=>state.lang==='ar'?ar:en;
  const byId=id=>(state.gallery||[]).find(item=>String(item.id)===String(id));
  const canSee=item=>!!(item.approved||isMine(item)||state.isAdmin);

  function galleryCard(item){
    const actions=state.isAdmin
      ? '<div class="gallery-pin-tools">'+
        (!item.approved?'<button type="button" data-approve-gallery="'+item.id+'" aria-label="Approve image">Approve</button>':'')+
        '<button type="button" data-feature-gallery="'+item.id+'">'+(item.featured?'Unfeature':'Feature')+'</button>'+
        '</div>'
      : '';
    return '<article class="gallery-pin" data-gallery-pin="'+item.id+'">'+
      '<button type="button" class="gallery-pin-open" data-gallery-open="'+item.id+'" aria-label="Open image">'+
      '<img src="'+esc(item.image_url)+'" alt="" loading="lazy" decoding="async"></button>'+
      (item.featured?'<span class="gallery-pin-featured">Featured</span>':'')+actions+
      '</article>';
  }

  gallery=function(){
    let items=(state.gallery||[]).filter(canSee);
    if(state.galleryFilter==='Featured')items=items.filter(item=>item.featured);
    if(state.galleryFilter==='Mine')items=items.filter(isMine);
    return pageTitle('Gallery','A visual collection shared by the NEIS community.',
      '<button class="primary" data-action="new-gallery">＋ Upload images</button>')+
      '<div class="gallery-toolbar"><div class="tabs">'+
      ['All','Featured','Mine'].map(value=>'<button class="'+(state.galleryFilter===value?'active':'')+'" data-gallery-filter="'+value+'">'+value+'</button>').join('')+
      '</div><span class="gallery-count">'+items.length+' '+(items.length===1?'image':'images')+'</span></div>'+
      (items.length?'<div class="gallery-masonry">'+items.map(galleryCard).join('')+'</div>':
      '<div class="gallery-empty"><div class="gallery-empty-icon">＋</div><b>'+t('Your gallery starts here','معرض الصور يبدأ من هنا')+'</b><span>'+t('Upload images. No titles, captions or tags needed.','ارفع صورك مباشرة، من غير عناوين أو أوصاف أو تصنيفات.')+'</span><button class="primary" data-action="new-gallery">'+t('Choose images','اختر الصور')+'</button></div>');
  };

  function openGalleryImage(id){
    const visible=(state.gallery||[]).filter(canSee);
    let index=visible.findIndex(item=>String(item.id)===String(id));
    if(index<0)return;
    const show=()=>{
      const item=visible[index];
      openModal('<div class="gallery-lightbox">'+
        '<div class="gallery-lightbox-top"><span>'+(index+1)+' / '+visible.length+'</span><button type="button" class="close" data-close aria-label="Close">×</button></div>'+
        '<div class="gallery-lightbox-stage"><button type="button" data-gallery-prev aria-label="Previous image" '+(index===0?'disabled':'')+'>‹</button>'+
        '<img src="'+esc(item.image_url)+'" alt="" decoding="async">'+
        '<button type="button" data-gallery-next aria-label="Next image" '+(index===visible.length-1?'disabled':'')+'>›</button></div></div>',true);
      const prev=document.querySelector('[data-gallery-prev]');
      const next=document.querySelector('[data-gallery-next]');
      if(prev)prev.onclick=()=>{if(index>0){index--;show()}};
      if(next)next.onclick=()=>{if(index<visible.length-1){index++;show()}};
    };
    show();
  }

  function newGallery(){
    if(!requireAccount())return;
    openModal('<div class="modal-head"><div><p class="kicker"><i></i>Gallery</p><h2>'+t('Upload images','رفع الصور')+'</h2>'+
      '<p>'+t('Choose up to 20 images. No title, caption or tags required.','اختر حتى 20 صورة. لا تحتاج إلى كتابة عنوان أو وصف أو تصنيفات.')+'</p></div>'+
      '<button class="close" data-close aria-label="Close">×</button></div>'+
      '<form id="galleryBatchForm"><label class="gallery-dropzone" for="galleryBatchFiles">'+
      '<span class="gallery-dropzone-icon">＋</span><b>'+t('Choose images','اختر الصور')+'</b>'+
      '<small>'+t('JPG, PNG, WebP or other image formats · up to 8 MB each','صور JPG وPNG وWebP وغيرها · حتى 8 ميجابايت للصورة')+'</small></label>'+
      '<input id="galleryBatchFiles" class="gallery-file-input" type="file" accept="image/*" multiple>'+
      '<div id="galleryBatchPreview" class="gallery-batch-preview"></div>'+
      '<div class="modal-actions"><button type="button" class="secondary" data-close>'+t('Cancel','إلغاء')+'</button>'+
      '<button type="submit" class="primary" id="galleryBatchSubmit" disabled>'+t('Upload images','رفع الصور')+'</button></div></form>');
    const input=document.getElementById('galleryBatchFiles');
    const preview=document.getElementById('galleryBatchPreview');
    const submit=document.getElementById('galleryBatchSubmit');
    let chosen=[];
    input.onchange=()=>{
      chosen=Array.from(input.files||[]).slice(0,MAX_FILES);
      if((input.files||[]).length>MAX_FILES)toast(t('You can upload up to 20 images at once.','يمكنك رفع 20 صورة كحد أقصى في المرة الواحدة.'));
      preview.innerHTML=chosen.map((file,index)=>{
        const valid=file.type.startsWith('image/')&&file.size>0&&file.size<=MAX_BYTES;
        return '<div class="gallery-batch-item '+(valid?'':'invalid')+'"><img src="'+URL.createObjectURL(file)+'" alt="">'+
          '<span>'+(valid?'Ready':(file.size>MAX_BYTES?'Over 8 MB':'Invalid image'))+'</span></div>';
      }).join('');
      submit.disabled=!chosen.length||chosen.some(file=>!file.type.startsWith('image/')||!file.size||file.size>MAX_BYTES);
    };
    document.getElementById('galleryBatchForm').onsubmit=async event=>{
      event.preventDefault();
      if(!chosen.length||submit.disabled)return;
      submit.disabled=true;
      input.disabled=true;
      let uploaded=0,failed=0;
      for(const file of chosen){
        const image_url=await uploadMedia(file,'gallery');
        if(!image_url){failed++;continue}
        const {error}=await sb.from('gallery_items').insert({
          author_id:authUser.id,image_url,caption_en:'',caption_ar:'',tags:[],approved:state.isAdmin
        });
        if(error){console.error('[NEIS gallery insert]',error);failed++}
        else uploaded++;
      }
      closeModal();
      if(window.NEISSecondaryData)await window.NEISSecondaryData.loadGallery({force:true,useCache:false});
      nav('gallery');
      toast(failed
        ?t(uploaded+' image(s) uploaded; '+failed+' failed.','تم رفع '+uploaded+' صورة؛ فشل رفع '+failed+'.')
        :t(uploaded+' image(s) added to the gallery.','تمت إضافة '+uploaded+' صورة إلى المعرض.'));
    };
  }

  const previousBind=bindDynamic;
  bindDynamic=function(){
    previousBind();
    document.querySelectorAll('[data-gallery-open]').forEach(button=>{
      button.onclick=()=>openGalleryImage(button.dataset.galleryOpen);
    });
  };
  window.NEISGalleryPinterest={version:'1.0.0',openImage:openGalleryImage};
})();