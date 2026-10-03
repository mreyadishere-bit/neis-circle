/* NEIS Circle Data Coordinator v171
   Coalesces duplicate global data loads without changing feature behavior. */
(function(){
  'use strict';
  if(window.__neisDataCoordinatorV171)return;
  window.__neisDataCoordinatorV171=true;

  if(typeof loadLiveData!=='function'){
    console.warn('[NEIS Data Coordinator] loadLiveData is not available.');
    return;
  }

  const underlyingLoad=loadLiveData;
  const BATCH_DELAY_MS=45;
  const TRAILING_DELAY_MS=20;

  let timer=null;
  let running=false;
  let currentWaiters=[];
  let nextWaiters=[];
  let cycle=0;

  const metrics={
    requested:0,
    executed:0,
    coalesced:0,
    trailingCycles:0,
    failures:0,
    lastDurationMs:0,
    lastStartedAt:null,
    lastCompletedAt:null
  };

  function settle(waiters,kind,value){
    for(const waiter of waiters){
      try{waiter[kind](value)}catch(_){}
    }
  }

  function schedule(delay){
    if(timer!==null)return;
    timer=setTimeout(runCycle,delay);
  }

  async function runCycle(){
    timer=null;
    if(running)return;

    const waiters=currentWaiters.splice(0);
    if(!waiters.length)return;

    running=true;
    cycle+=1;
    metrics.executed+=1;
    metrics.lastStartedAt=new Date().toISOString();
    const started=performance.now();

    let value;
    let failure=null;
    try{
      value=await underlyingLoad();
    }catch(error){
      failure=error;
      metrics.failures+=1;
      console.error('[NEIS Data Coordinator] load cycle failed',error);
    }finally{
      metrics.lastDurationMs=Math.round(performance.now()-started);
      metrics.lastCompletedAt=new Date().toISOString();
      running=false;
    }

    if(failure)settle(waiters,'reject',failure);
    else settle(waiters,'resolve',value);

    if(nextWaiters.length){
      metrics.trailingCycles+=1;
      currentWaiters.push(...nextWaiters.splice(0));
      schedule(TRAILING_DELAY_MS);
    }
  }

  function coordinatedLoad(){
    metrics.requested+=1;

    return new Promise((resolve,reject)=>{
      const waiter={resolve,reject};

      if(running){
        metrics.coalesced+=1;
        nextWaiters.push(waiter);
        return;
      }

      if(timer!==null||currentWaiters.length){
        metrics.coalesced+=1;
      }

      currentWaiters.push(waiter);
      schedule(BATCH_DELAY_MS);
    });
  }

  coordinatedLoad.__neisDataCoordinated=true;
  coordinatedLoad.__underlyingLoad=underlyingLoad;
  loadLiveData=coordinatedLoad;

  window.NEISDataCoordinator={
    version:'171.0',
    refresh:coordinatedLoad,
    flush(){
      if(timer!==null){
        clearTimeout(timer);
        timer=null;
      }
      if(!running&&currentWaiters.length)runCycle();
    },
    snapshot(){
      return {
        ...metrics,
        running,
        scheduled:timer!==null,
        queuedCurrent:currentWaiters.length,
        queuedTrailing:nextWaiters.length,
        cycle
      };
    }
  };
})();