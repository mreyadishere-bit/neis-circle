/* NEIS Circle Gallery refresh — isolated presentation/upload layer.
   Keeps the existing gallery_items table, storage bucket, moderation and resource loader. */
(function(){
  'use strict';
  if(window.__neisPinterestGalleryV1)return;
  window.__neisPinterestGalleryV1=true;

  const MAX_FILES=20;
  const MAX_BYTES=8*1024*1024;
  state.galleryCategory=state.galleryCategory||'photograph';
  state.galleryUploaderFilter=state.galleryUploaderFilter==='mine'?'mine':'everyone';
  state.gallerySortOrder=state.gallerySortOrder==='oldest'?'oldest':'latest';
  const categories=[{id:'photograph',en:'Photograph',ar:'تصوير فوتوغرافي',desc:'Photography, places, people and moments.'},{id:'art',en:'Art',ar:'فن',desc:'Illustrations, sketches, paintings and creative work.'}];
  const categoryLabel=id=>{const item=categories.find(x=>x.id===id)||categories[0];return t(item.en,item.ar)};
  const t=(en,ar)=>state.lang==='ar'?ar:en;
  const canSee=item=>!!(item.approved||isMine(item)||state.isAdmin);

  function formatGalleryDate(value){
    if(!value)return '';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return '';
    try{
      return new Intl.DateTimeFormat(state.lang==='ar'?'ar-EG':'en-GB',{
        day:'numeric',month:'short',year:'numeric'
      }).format(date);
    }catch(_){
      return date.toLocaleDateString();
    }
  }

  const MAIN_ADMIN_ID='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd';

  function galleryVisibleItems(category){
    let items=(state.gallery||[]).filter(canSee).filter(item=>(item.category||'photograph')===category);
    if(state.galleryUploaderFilter==='mine')items=items.filter(isMine);
    const direction=state.gallerySortOrder==='oldest'?1:-1;
    return items.slice().sort((a,b)=>{
      const aTime=Date.parse(a.created_at||'')||0;
      const bTime=Date.parse(b.created_at||'')||0;
      return (aTime-bTime)*direction;
    });
  }

  function formatGalleryDate(value){
    if(!value)return '';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return '';
    try{return new Intl.DateTimeFormat(state.lang==='ar'?'ar-EG':'en-GB',{day:'numeric',month:'short',year:'numeric'}).format(date)}
    catch(_){return date.toLocaleDateString()}
  }

  function canDeleteGallery(){
    return !!(state.isAdmin&&authUser&&String(authUser.id)===MAIN_ADMIN_ID);
  }

  function galleryCard(item){
    const author=Array.isArray(item.author)?(item.author[0]||{}):(item.author||{});
    const authorName=String(author.full_name||author.username||t('NEIS student','طالب NEIS')).trim();
    const branch=String(author.branch||author.campus||'').trim();
    const rawGrade=String(author.grade||'').trim();
    let grade='';
    if(/^graduate$/i.test(rawGrade))grade=t('Graduate','خريج');
    else if(/^grade\s*/i.test(rawGrade))grade=state.lang==='ar'?'الصف '+rawGrade.replace(/^grade\s*/i,''):rawGrade;
    else if(rawGrade)grade=state.lang==='ar'?'الصف '+rawGrade:'Grade '+rawGrade;
    const dateLabel=formatGalleryDate(item.created_at);
    const details=[];
    if(branch)details.push('<span>'+esc(branch)+'</span>');
    if(grade)details.push('<span>'+esc(grade)+'</span>');
    if(dateLabel)details.push('<time datetime="'+esc(item.created_at||'')+'">'+esc(dateLabel)+'</time>');
    const metadata='<div class="gallery-pin-meta"><b class="gallery-pin-meta-name">'+esc(authorName)+'</b>'+
      (details.length?'<div class="gallery-pin-meta-details">'+details.join('<span class="gallery-pin-meta-separator" aria-hidden="true">·</span>')+'</div>':'')+
      '</div>';
    const actions=state.isAdmin
      ? '<div class="gallery-pin-tools">'+
        (!item.approved?'<button type="button" data-approve-gallery="'+item.id+'" aria-label="Approve image">'+t('Approve','موافقة')+'</button>':'')+
        (canDeleteGallery()?'<button type="button" class="gallery-delete-button" data-delete-gallery="'+item.id+'" aria-label="Delete image">'+t('Delete','حذف')+'</button>':'')+
        '</div>'
      : '';
    return '<article class="gallery-pin" data-gallery-pin="'+item.id+'">'+
      '<button type="button" class="gallery-pin-open" data-gallery-open="'+item.id+'" aria-label="Open image">'+
      '<img src="'+esc(item.image_url)+'" alt="" loading="lazy" decoding="async"></button>'+
      metadata+actions+'</article>';
  }

  gallery=function(){
    const category=state.galleryCategory==='art'?'art':'photograph';
    const items=galleryVisibleItems(category);
    const tabs=categories.map(item=>'<button type="button" class="gallery-category-tab '+(category===item.id?'active':'')+'" data-gallery-category="'+item.id+'"><b>'+t(item.en,item.ar)+'</b><span>'+t(item.desc,item.id==='art'?'رسومات ولوحات وأعمال إبداعية.':'صور فوتوغرافية وأماكن ولحظات.')+'</span></button>').join('');
    const controls='<div class="gallery-filter-controls">'+
      '<label class="gallery-control"><span>'+t('Filter','تصفية')+'</span><select data-gallery-uploader-filter aria-label="'+t('Filter gallery images','تصفية صور المعرض')+'">'+
        '<option value="everyone" '+(state.galleryUploaderFilter==='everyone'?'selected':'')+'>'+t('Everyone','الجميع')+'</option>'+
        '<option value="mine" '+(state.galleryUploaderFilter==='mine'?'selected':'')+'>'+t('My uploads','صوري')+'</option>'+
      '</select></label>'+
      '<label class="gallery-control"><span>'+t('Sort by','ترتيب حسب')+'</span><select data-gallery-sort aria-label="'+t('Sort gallery images','ترتيب صور المعرض')+'">'+
        '<option value="latest" '+(state.gallerySortOrder==='latest'?'selected':'')+'>'+t('Latest upload','أحدث رفع')+'</option>'+
        '<option value="oldest" '+(state.gallerySortOrder==='oldest'?'selected':'')+'>'+t('Oldest upload','أقدم رفع')+'</option>'+
      '</select></label></div>';
    return pageTitle('Gallery','A visual collection shared by the NEIS community.',
      '<button class="primary" data-action="new-gallery">＋ '+t('Upload images','رفع الصور')+'</button>')+
      '<div class="gallery-category-switch" role="tablist" aria-label="Gallery category">'+tabs+'</div>'+
      '<div class="gallery-toolbar">'+controls+'<span class="gallery-count">'+items.length+' '+t('images','صور')+'</span></div>'+
      (items.length?'<div class="gallery-masonry">'+items.map(galleryCard).join('')+'</div>':
      '<div class="gallery-empty"><div class="gallery-empty-icon">＋</div><b>'+t('No images found','لا توجد صور')+'</b><span>'+t('Try another filter or upload the first image.','جرّب فلترًا آخر أو ارفع أول صورة.')+'</span><button class="primary" data-action="new-gallery">'+t('Upload images','رفع الصور')+'</button></div>');
  };

  function openGalleryImage(id){
    const activeCategory=state.galleryCategory==='art'?'art':'photograph';
    const visible=galleryVisibleItems(activeCategory);
    let index=visible.findIndex(item=>String(item.id)===String(id));
    if(index<0)return;
    const show=()=>{
      const item=visible[index];
      openModal('<div class="gallery-lightbox">'+
        '<div class="gallery-lightbox-top"><span>'+(index+1)+' / '+visible.length+'</span><button type="button" class="close" data-close aria-label="Close">×</button></div>'+
        '<div class="gallery-lightbox-stage"><button type="button" data-gallery-prev aria-label="Previous image" '+(index===0?'disabled':'')+'>‹</button>'+
        '<img src="'+esc(item.image_url)+'" alt="" decoding="async">'+
        '<button type="button" data-gallery-next aria-label="Next image" '+(index===visible.length-1?'disabled':'')+'>›</button></div>'+
        (canDeleteGallery()?'<div class="gallery-lightbox-actions"><button type="button" class="gallery-delete-button" data-delete-gallery-modal="'+item.id+'">'+t('Delete image','حذف الصورة')+'</button></div>':'')+
        '</div>',true);
      const prev=document.querySelector('[data-gallery-prev]');
      const next=document.querySelector('[data-gallery-next]');
      const deleteButton=document.querySelector('[data-delete-gallery-modal]');
      if(deleteButton)deleteButton.onclick=()=>deleteGalleryImage(deleteButton.dataset.deleteGalleryModal);
      if(prev)prev.onclick=()=>{if(index>0){index--;show()}};
      if(next)next.onclick=()=>{if(index<visible.length-1){index++;show()}};
      const stage=document.querySelector('.gallery-lightbox-stage');
      if(stage){let touchStart=0;stage.ontouchstart=event=>{touchStart=event.changedTouches[0]?.clientX||0};stage.ontouchend=event=>{const delta=(event.changedTouches[0]?.clientX||0)-touchStart;if(Math.abs(delta)>55){if(delta<0&&index<visible.length-1){index++;show()}else if(delta>0&&index>0){index--;show()}}};}
    };
    show();
  }

  function newGallery(){
    if(!requireAccount())return;
    openModal('<div class="modal-head"><div><p class="kicker"><i></i>Gallery</p><h2>'+t('Upload images','رفع الصور')+'</h2>'+
      '<p>'+t('Choose up to 20 images. No title, caption or tags required.','اختر حتى 20 صورة. لا تحتاج إلى كتابة عنوان أو وصف أو تصنيفات.')+'</p></div>'+
      '<button class="close" data-close aria-label="Close">×</button></div>'+
      '<form id="galleryBatchForm"><label class="gallery-category-select-label" for="galleryUploadCategory">'+t('Add images to','أضف الصور إلى')+'</label><select id="galleryUploadCategory" class="gallery-category-select">'+categories.map(item=>'<option value="'+item.id+'" '+(item.id===state.galleryCategory?'selected':'')+'>'+t(item.en,item.ar)+'</option>').join('')+'</select><label class="gallery-dropzone" for="galleryBatchFiles">'+
      '<span class="gallery-dropzone-icon">＋</span><b>'+t('Choose images','اختر الصور')+'</b>'+
      '<small>'+t('JPG, PNG, WebP or other image formats · up to 8 MB each','صور JPG وPNG وWebP وغيرها · حتى 8 ميجابايت للصورة')+'</small></label>'+
      '<input id="galleryBatchFiles" class="gallery-file-input" type="file" accept="image/*" multiple>'+
      '<div id="galleryBatchPreview" class="gallery-batch-preview"></div>'+
      '<div class="modal-actions"><button type="button" class="secondary" data-close>'+t('Cancel','إلغاء')+'</button>'+
      '<button type="submit" class="primary" id="galleryBatchSubmit" disabled>'+t('Upload images','رفع الصور')+'</button></div></form>');
    const input=document.getElementById('galleryBatchFiles');
    const preview=document.getElementById('galleryBatchPreview');
    const submit=document.getElementById('galleryBatchSubmit');
    let chosen=[],previewUrls=[];
    input.onchange=()=>{
      previewUrls.forEach(url=>URL.revokeObjectURL(url));
      previewUrls=[];
      chosen=Array.from(input.files||[]).slice(0,MAX_FILES);
      if((input.files||[]).length>MAX_FILES)toast(t('You can upload up to 20 images at once.','يمكنك رفع 20 صورة كحد أقصى في المرة الواحدة.'));
      preview.innerHTML=chosen.map((file,index)=>{
        const valid=file.type.startsWith('image/')&&file.size>0&&file.size<=MAX_BYTES;
        const previewUrl=URL.createObjectURL(file);previewUrls.push(previewUrl);
        return '<div class="gallery-batch-item '+(valid?'':'invalid')+'"><img src="'+previewUrl+'" alt="">'+
          '<span>'+(valid?'Ready':(file.size>MAX_BYTES?'Over 8 MB':'Invalid image'))+'</span></div>';
      }).join('');
      submit.disabled=!chosen.length||chosen.some(file=>!file.type.startsWith('image/')||!file.size||file.size>MAX_BYTES);
    };
    document.getElementById('galleryBatchForm').onsubmit=async event=>{
      event.preventDefault();
      if(!chosen.length||submit.disabled)return;
      submit.disabled=true;
      input.disabled=true;
      const selectedCategory=document.getElementById('galleryUploadCategory').value==='art'?'art':'photograph';
      state.galleryCategory=selectedCategory;
      let uploaded=0,failed=0;
      for(const file of chosen){
        const image_url=await uploadMedia(file,'gallery');
        if(!image_url){failed++;continue}
        const {error}=await sb.from('gallery_items').insert({
          author_id:authUser.id,image_url,category:selectedCategory,caption_en:'',caption_ar:'',tags:[],approved:state.isAdmin
        });
        if(error){console.error('[NEIS gallery insert]',error);failed++}
        else uploaded++;
      }
      previewUrls.forEach(url=>URL.revokeObjectURL(url));
      closeModal();
      if(window.NEISSecondaryData)await window.NEISSecondaryData.loadGallery({force:true,useCache:false});
      nav('gallery');
      toast(failed
        ?t(uploaded+' image(s) uploaded; '+failed+' failed.','تم رفع '+uploaded+' صورة؛ فشل رفع '+failed+'.')
        :t(uploaded+' image(s) added to the gallery.','تمت إضافة '+uploaded+' صورة إلى المعرض.'));
    };
  }

  function galleryStoragePath(imageUrl){
    try{
      const url=new URL(String(imageUrl||''));
      const marker='/storage/v1/object/public/community-media/';
      const index=url.pathname.indexOf(marker);
      if(index<0)return '';
      const encoded=url.pathname.slice(index+marker.length);
      if(!encoded)return '';
      return encoded.split('/').map(segment=>decodeURIComponent(segment)).join('/');
    }catch(_){return ''}
  }

  async function deleteGalleryImage(id){
    if(!canDeleteGallery()||!sb)return;
    const item=(state.gallery||[]).find(row=>String(row.id)===String(id));
    if(!item)return;
    const confirmed=window.confirm(t(
      'Delete this image permanently from the Gallery? This cannot be undone.',
      'هل تريد حذف هذه الصورة نهائيًا من المعرض؟ لا يمكن التراجع عن هذا الإجراء.'
    ));
    if(!confirmed)return;

    const safeId=String(id).replace(/[^0-9]/g,'');
    const buttons=Array.from(document.querySelectorAll('[data-delete-gallery="'+safeId+'"],[data-delete-gallery-modal="'+safeId+'"]'));
    buttons.forEach(button=>{button.disabled=true;button.textContent=t('Deleting…','جارٍ الحذف…')});

    try{
      const {data,error}=await sb.rpc('admin_delete_moderation_content',{
        content_type_input:'gallery',
        content_id_input:String(id)
      });
      if(error)throw error;
      if(data!==true)throw new Error(t('The image was not found or was already deleted.','لم يتم العثور على الصورة أو أنها حُذفت بالفعل.'));

      state.gallery=(state.gallery||[]).filter(row=>String(row.id)!==String(id));
      window.NEISSecondaryData?.invalidate?.('gallery');
      closeModal();

      const path=galleryStoragePath(item.image_url);
      let cleanupError=null;
      if(path){
        const {error:storageError}=await sb.storage.from('community-media').remove([path]);
        if(storageError)cleanupError=storageError;
      }else{
        cleanupError=new Error('Storage URL was not a recognized community-media public URL');
      }

      try{
        if(window.NEISSecondaryData)await window.NEISSecondaryData.loadGallery({force:true,useCache:false});
      }catch(loadError){
        console.warn('[NEIS gallery] refresh after delete failed',loadError);
      }
      render();
      if(cleanupError){
        console.warn('[NEIS gallery] database row removed but Storage cleanup failed',cleanupError);
        toast(t('Image removed from the Gallery. Storage cleanup needs attention.','تم حذف الصورة من المعرض، لكن تنظيف ملف التخزين يحتاج إلى مراجعة.'));
      }else{
        toast(t('Image deleted from the Gallery.','تم حذف الصورة من المعرض.'));
      }
    }catch(error){
      console.error('[NEIS gallery delete]',error);
      buttons.forEach(button=>{button.disabled=false;button.textContent=t('Delete','حذف')});
      toast(t('Could not delete this image: ','تعذر حذف الصورة: ')+String(error?.message||error).slice(0,170));
    }
  }

  const previousBind=bindDynamic;
  bindDynamic=function(){
    previousBind();
    document.querySelectorAll('[data-action="new-gallery"]').forEach(button=>{button.onclick=newGallery;});
    document.querySelectorAll('[data-gallery-category]').forEach(button=>{button.onclick=()=>{state.galleryCategory=button.dataset.galleryCategory==='art'?'art':'photograph';render()}});
    document.querySelectorAll('[data-gallery-uploader-filter]').forEach(select=>{
      select.onchange=()=>{state.galleryUploaderFilter=select.value==='mine'?'mine':'everyone';render()};
    });
    document.querySelectorAll('[data-gallery-sort]').forEach(select=>{
      select.onchange=()=>{state.gallerySortOrder=select.value==='oldest'?'oldest':'latest';render()};
    });
    document.querySelectorAll('[data-gallery-open]').forEach(button=>{
      button.onclick=()=>openGalleryImage(button.dataset.galleryOpen);
    });
    document.querySelectorAll('[data-approve-gallery]').forEach(button=>{
      button.onclick=()=>window.moderateGallery?.(button.dataset.approveGallery,{approved:true});
    });
    document.querySelectorAll('[data-delete-gallery]').forEach(button=>{
      button.onclick=()=>deleteGalleryImage(button.dataset.deleteGallery);
    });
    document.querySelectorAll('[data-delete-gallery-modal]').forEach(button=>{
      button.onclick=()=>deleteGalleryImage(button.dataset.deleteGalleryModal);
    });
  };
  window.newGallery=newGallery;
  window.NEISGalleryPinterest={version:'1.3.0',openImage:openGalleryImage,deleteImage:deleteGalleryImage};
})();