/* Best Articles — isolated feature module.
   Keeps auth, onboarding, core loading and navigation untouched. */
(function(){
  'use strict';

  const MAIN_ADMIN_ID='25b556a3-ec6f-49e7-ac6c-1b09720e3bfd';

  if(typeof window==='undefined'||typeof state==='undefined')return;
  if(typeof articleCard!=='function'||typeof articles!=='function'||typeof home!=='function'||typeof bindDynamic!=='function')return;

  if(!state.articleFilter)state.articleFilter='All';

  const baseArticleCard=articleCard;
  const baseArticles=articles;
  const baseHome=home;
  const baseBindDynamic=bindDynamic;

  const isMainAdmin=()=>typeof authUser!=='undefined'&&!!authUser&&String(authUser.id)===MAIN_ADMIN_ID;
  const featuredArticles=()=>[...(state.articles||[])]
    .filter(article=>article?.status==='published'&&article?.featured===true)
    .sort((a,b)=>new Date(b.featured_at||0)-new Date(a.featured_at||0));

  articleCard=function(article){
    let html=baseArticleCard(article);
    if(!article||typeof html!=='string')return html;

    let metaExtras='';
    if(isMainAdmin()&&article.status==='published'){
      metaExtras+='<button type="button" class="article-feature-star '+(article.featured?'active':'')+'" data-feature-article="'+String(article.id)+'" aria-pressed="'+(article.featured?'true':'false')+'" title="'+(article.featured?'Remove from Best Articles':'Feature as Best Article')+'" aria-label="'+(article.featured?'Remove from Best Articles':'Feature as Best Article')+'">'+(article.featured?'★':'☆')+'</button>';
    }
    if(article.featured){
      metaExtras+='<span class="best-article-badge" title="Featured article">★ Best Article</span>';
    }
    if(metaExtras)html=html.replace('<div class="article-meta">','<div class="article-meta">'+metaExtras);

    return html;
  };

  articles=function(){
    const originalArticles=state.articles;
    const filter=state.articleFilter||'All';
    let html='';

    try{
      if(filter==='Best')state.articles=featuredArticles();
      html=baseArticles();
    }finally{
      state.articles=originalArticles;
    }

    if(typeof html!=='string')return html;

    const filterTabs='<div class="tabs best-articles-tabs" style="margin:0 0 14px 0">'+
      '<button class="'+(filter==='All'?'active':'')+'" data-article-feature-filter="All">All Articles</button>'+
      '<button class="'+(filter==='Best'?'active':'')+'" data-article-feature-filter="Best">★ Best Articles</button>'+
      '</div>';

    const controlsMarker='<div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:18px">';
    if(html.includes(controlsMarker))html=html.replace(controlsMarker,filterTabs+controlsMarker);
    else html=filterTabs+html;

    if(filter==='Best'&&!featuredArticles().length){
      html=html
        .replace('<b>No articles yet</b>','<b>No featured articles yet</b>')
        .replace('<span>Publish the first complete student article.</span>','<span>The main admin can feature published articles from All Articles.</span>');
    }

    return html;
  };

  home=function(){
    const originalArticles=state.articles;
    let html='';

    try{
      state.articles=featuredArticles();
      html=baseHome();
    }finally{
      state.articles=originalArticles;
    }

    if(typeof html!=='string')return html;

    html=html
      .replace(/Latest articles/g,'Best Articles')
      .replace(/أحدث المقالات/g,'أفضل المقالات')
      .replace(/(<h2>(?:Best Articles|أفضل المقالات)<\/h2><\/div><button class="secondary" data-nav="articles")/,'$1 data-open-best-articles');

    return html;
  };

  bindDynamic=function(){
    baseBindDynamic();

    document.querySelectorAll('[data-article-feature-filter]').forEach(button=>{
      button.onclick=()=>{
        state.articleFilter=button.dataset.articleFeatureFilter||'All';
        state.articleAuthor='';
        render();
      };
    });

    document.querySelectorAll('[data-nav="articles"]:not([data-open-best-articles])').forEach(button=>{
      const previous=button.onclick;
      button.onclick=event=>{
        state.articleFilter='All';
        state.articleAuthor='';
        if(typeof previous==='function')return previous.call(button,event);
        nav('articles');
      };
    });

    document.querySelectorAll('[data-open-best-articles]').forEach(button=>{
      button.onclick=event=>{
        event.preventDefault();
        event.stopPropagation();
        state.articleFilter='Best';
        nav('articles');
      };
    });

    document.querySelectorAll('[data-feature-article]').forEach(button=>{
      button.onclick=async event=>{
        event.preventDefault();
        event.stopPropagation();

        if(!isMainAdmin()||button.disabled)return;
        const article=(state.articles||[]).find(item=>String(item.id)===String(button.dataset.featureArticle));
        if(!article||article.status!=='published')return;

        button.disabled=true;
        const makeFeatured=!article.featured;
        const {error}=await sb.rpc('set_article_featured',{
          p_article_id:String(article.id),
          p_featured:makeFeatured
        });

        if(error){
          button.disabled=false;
          toast(window.neisFriendlyError?.(error,'update this article')||error.message);
          return;
        }

        await loadLiveData();
        render();
        toast(makeFeatured?'Article added to Best Articles.':'Article removed from Best Articles.');
      };
    });
  };
})();
