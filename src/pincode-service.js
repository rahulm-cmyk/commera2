const clean=value=>String(value??'').trim();
const builtin={
  '110001':{city:'New Delhi',state:'Delhi',country:'India'},
  '380001':{city:'Ahmedabad',state:'Gujarat',country:'India'},
  '380015':{city:'Ahmedabad',state:'Gujarat',country:'India'},
  '560001':{city:'Bengaluru',state:'Karnataka',country:'India'},
  '560038':{city:'Bengaluru',state:'Karnataka',country:'India'}
};

async function indiaPostLookup(pincode){
  if(builtin[pincode])return builtin[pincode];
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{
    const response=await fetch(`https://api.postalpincode.in/pincode/${pincode}`,{signal:controller.signal,headers:{accept:'application/json'}});
    if(!response.ok)return null;
    const payload=await response.json(),office=payload?.[0]?.PostOffice?.[0];
    if(payload?.[0]?.Status!=='Success'||!office)return null;
    return{city:clean(office.District||office.Division||office.Name),state:clean(office.State),country:clean(office.Country)||'India'};
  }catch{return null;}finally{clearTimeout(timer);}
}

export class PincodeService{
  constructor(db,{lookup=indiaPostLookup,serviceability=null}={}){this.db=db;this.lookup=lookup;this.serviceability=serviceability;}
  async resolve(storeId,pincode){
    if(!this.db.prepare('SELECT id FROM stores WHERE id=?').get(storeId))throw Error('Store not found');
    const code=clean(pincode);
    if(!/^[1-9][0-9]{5}$/.test(code))throw Error('Please enter a valid pincode');
    let location=this.db.prepare('SELECT city,state,country FROM pincode_cache WHERE pincode=?').get(code);
    if(!location){
      location=await this.lookup(code);
      if(!location||!clean(location.city)||!clean(location.state))throw Error('Please enter a valid pincode');
      location={city:clean(location.city),state:clean(location.state),country:clean(location.country)||'India'};
      if(location.country.toLowerCase()!=='india')throw Error('Please enter a valid pincode');
      this.db.prepare(`INSERT INTO pincode_cache (pincode,city,state,country,source) VALUES (?,?,?,?,?) ON CONFLICT(pincode) DO UPDATE SET city=excluded.city,state=excluded.state,country=excluded.country,source=excluded.source,updated_at=CURRENT_TIMESTAMP`).run(code,location.city,location.state,'India',this.lookup===indiaPostLookup?'india_post':'adapter');
    }
    const serviceable=this.serviceability?Boolean(await this.serviceability({storeId,pincode:code,...location})):this.#configuredServiceability(storeId,location.state);
    if(!serviceable)throw Error('Delivery is not available at this pincode');
    return{pincode:code,city:location.city,state:location.state,country:'India',serviceable:true};
  }
  #configuredServiceability(storeId,state){
    const methods=this.db.prepare('SELECT COUNT(*) count FROM shipping_methods WHERE store_id=? AND enabled=1').get(storeId).count;
    if(!methods)return true;
    const zones=this.db.prepare('SELECT COUNT(*) count FROM shipping_zones WHERE store_id=? AND enabled=1').get(storeId).count;
    if(!zones)return true;
    return Boolean(this.db.prepare('SELECT 1 FROM shipping_zones WHERE store_id=? AND enabled=1 AND lower(state)=lower(?)').get(storeId,state));
  }
}
