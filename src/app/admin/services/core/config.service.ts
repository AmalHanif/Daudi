import { Injectable } from "@angular/core";
import { AngularFirestore } from "@angular/fire/firestore";
import { Admin } from "../../../models/Daudi/admin/Admin";
import { emptyConfig, OMCConfig } from "../../../models/Daudi/omc/Config";
import { AdminService } from "./admin.service";

@Injectable({
  providedIn: "root"
})
export class ConfigService {

  constructor(private db: AngularFirestore, private adminservice: AdminService) {

  }


  configCollection(omcId: string) {
    return this.db.firestore.collection("omc")
      .doc(omcId)
      .collection("config")
      .doc("main");
  }


  initConfig(admin: Admin) {
    const newConfig: OMCConfig = { ...emptyConfig };
    this.saveConfig(admin.config.omcId, newConfig);
  }

  saveConfig(omcId: string, data: OMCConfig) {
    return this.db.firestore.collection("omc")
      .doc(omcId)
      .collection("config")
      .doc("main")
      .set(data);
  }
}
