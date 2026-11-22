import assert from "node:assert/strict";
import {factoryResetStorage} from "../src/domain/factory-reset.js";
class MockStorage {
  data=new Map();
  get length(){return this.data.size;}
  key(i){return [...this.data.keys()][i]??null;}
  getItem(k){return this.data.has(k)?this.data.get(k):null;}
  setItem(k,v){this.data.set(k,String(v));}
  removeItem(k){this.data.delete(k);}
}
const storage=new MockStorage();
storage.setItem("downtimeui:tenant:v1","config");
storage.setItem("downtimeui:setup:draft:v1","draft");
storage.setItem("downtimeui:operations:v1:install-123","ops");
storage.setItem("unrelated:app:data","leave");
const result=factoryResetStorage(storage);
assert.equal(result.ok,true);
assert.equal(result.removedKeys,3);
assert.equal(storage.getItem("downtimeui:tenant:v1"),null);
assert.equal(storage.getItem("downtimeui:setup:draft:v1"),null);
assert.equal(storage.getItem("downtimeui:operations:v1:install-123"),null);
assert.equal(storage.getItem("unrelated:app:data"),"leave");
const empty=new MockStorage();
assert.deepEqual(factoryResetStorage(empty),{ok:true,removedKeys:0});
class BrokenStorage extends MockStorage {
  removeItem(key){if(key==="downtimeui:setup:draft:v1")throw new Error("blocked");super.removeItem(key);}
}
const broken=new BrokenStorage();
broken.setItem("downtimeui:tenant:v1","config");
broken.setItem("downtimeui:setup:draft:v1","draft");
const failed=factoryResetStorage(broken);
assert.equal(failed.ok,false);
assert.equal(broken.getItem("downtimeui:tenant:v1"),"config");
assert.equal(broken.getItem("downtimeui:setup:draft:v1"),"draft");
console.log("PASS: factory reset storage namespace, no-op and rollback checks");
