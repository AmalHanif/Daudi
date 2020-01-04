import { Injectable } from "@angular/core";
import { AngularFirestore } from "@angular/fire/firestore";
import * as moment from "moment";
import { BehaviorSubject, combineLatest } from "rxjs";
import { distinctUntilChanged, skipWhile } from "rxjs/operators";
import { DaudiCustomer, emptyDaudiCustomer } from "../../../models/Daudi/customer/Customer";
import { Depot, emptydepot } from "../../../models/Daudi/depot/Depot";
import { DepotConfig, emptyDepotConfig } from "../../../models/Daudi/depot/DepotConfig";
import { Entry, emptyEntry } from "../../../models/Daudi/fuel/Entry";
import { FuelNamesArray } from "../../../models/Daudi/fuel/FuelType";
import { Config, emptyConfig, QboEnvironment } from "../../../models/Daudi/omc/Config";
import { Environment } from "../../../models/Daudi/omc/Environments";
import { emptyomc, OMC } from "../../../models/Daudi/omc/OMC";
import { emptyorder, Order } from "../../../models/Daudi/order/Order";
import { OrderStageIds, OrderStages } from "../../../models/Daudi/order/OrderStages";
import { AttachId } from "../../../shared/pipes/attach-id.pipe";
import { CustomerService } from "../customers.service";
import { OrdersService } from "../orders.service";
import { AdminService } from "./admin.service";
import { ConfigService } from "./config.service";
import { DepotService } from "./depot.service";
import { OmcService } from "./omc.service";
import { EntriesService } from "../entries.service";

@Injectable({
  providedIn: "root"
})
/**
 * This singleton keeps all the variables needed by the app to run and automatically keeps and manages the subscriptions
 */
export class CoreService {
  config: BehaviorSubject<Config> = new BehaviorSubject<Config>({ ...emptyConfig });
  environment: BehaviorSubject<Environment> = new BehaviorSubject<Environment>(Environment.sandbox);
  depots: BehaviorSubject<Array<Depot>> = new BehaviorSubject([]);
  customers: BehaviorSubject<Array<DaudiCustomer>> = new BehaviorSubject<Array<DaudiCustomer>>([]);
  omcs: BehaviorSubject<Array<OMC>> = new BehaviorSubject<Array<OMC>>([]);
  currentOmc: BehaviorSubject<OMC> = new BehaviorSubject<OMC>(emptyomc);
  /**
   * Be careful when subscribing to this value because it will always emit a value
   */
  activedepot: BehaviorSubject<{ depot: Depot, config: DepotConfig }> = new BehaviorSubject({ depot: { ...emptydepot }, config: { ...emptyDepotConfig } });
  /**
   * this keeps a local copy of all the subscriptions within this service
   */
  subscriptions: Map<string, () => void> = new Map<string, () => void>();
  /**
   * keeps an updated copy of core variables fetch status
   */
  loaders = {
    depots: new BehaviorSubject<boolean>(true),
    customers: new BehaviorSubject<boolean>(true),
    entries: new BehaviorSubject<boolean>(true),
    omc: new BehaviorSubject<boolean>(true),
    orders: new BehaviorSubject<boolean>(true)
  };
  depotEntries: {
    pms: BehaviorSubject<Array<Entry>>,
    ago: BehaviorSubject<Array<Entry>>,
    ik: BehaviorSubject<Array<Entry>>,
  } = {
      pms: new BehaviorSubject([]),
      ago: new BehaviorSubject([]),
      ik: new BehaviorSubject([])
    };

  fueltypesArray = FuelNamesArray;
  orders: {
    [key in OrderStages]: BehaviorSubject<Array<Order>>
  } = {
      1: new BehaviorSubject<Array<Order>>([]),
      2: new BehaviorSubject<Array<Order>>([]),
      3: new BehaviorSubject<Array<Order>>([]),
      4: new BehaviorSubject<Array<Order>>([]),
      5: new BehaviorSubject<Array<Order>>([]),
      6: new BehaviorSubject<Array<Order>>([])
    };
  queuedorders = new BehaviorSubject([]);

  constructor(
    private db: AngularFirestore,
    private configService: ConfigService,
    private depotService: DepotService,
    private omc: OmcService,
    private orderService: OrdersService,
    private attachId: AttachId,
    private customerService: CustomerService,
    private entriesService: EntriesService,
    private adminservice: AdminService) {
    this.adminservice.observableuserdata
      .pipe(distinctUntilChanged())
      .subscribe(admin => {
        this.subscriptions.set("configSubscription", this.configService.configCollection(admin.config.omcId)
          .onSnapshot(t => {
            // console.log(t.data());
            this.config.next(this.attachId.transformObject<Config>(emptyConfig, t));
            /**
             * Fetch OMC's and depots after the main config has been loaded
             */
            this.getOmcs();
            this.getDepots();
          }));
      });

    /**
     * fetch the pipeline every time the depot changes
     */

    combineLatest([this.activedepot.pipe(skipWhile(t => !t.depot.Id)),
    this.currentOmc.pipe(skipWhile(t => !t.Id))]).subscribe(() => {
      this.getOrdersPipeline();
      this.getallcustomers();
      this.fetchActiveEntries();
    });

  }

  getDepots() {
    this.subscriptions.set("alldepots", this.depotService
      .depotsCollection()
      .where("Active", "==", true)
      .orderBy("Name", "asc")
      .onSnapshot((data) => {
        this.unsubscribeAll();
        /**
         * Only subscribe to depot when the user data changes
         */
        this.depots.next(this.attachId.transformArray<Depot>(emptydepot, data));
        const tempdepot: Depot = this.depots.value[0];
        if (this.depots.value.find(depot => depot.Id === this.activedepot.value.depot.Id)) {
          this.changeactivedepot(this.depots.value.find(depot => depot.Id === this.activedepot.value.depot.Id));
        } else {
          this.changeactivedepot(tempdepot);
        }

      })
    );
  }
  getOmcs() {
    this.subscriptions.set("omcs", this.omc.omcCollection()
      .orderBy("name", "asc")
      .onSnapshot(data => {
        // console.log("OMC data fetched");
        this.omcs.next(this.attachId.transformArray<OMC>(emptyomc, data));
        this.omcs.value.forEach(co => {
          if (co.Id === this.adminservice.userdata.config.omcId) {
            /**
             * Only make the pipeline subscription once
             */
            if (this.currentOmc.value.Id !== this.adminservice.userdata.config.omcId) {
              console.log("Current OMC found");
              this.currentOmc.next(co);
            }
            this.currentOmc.next(co);
          }
        });

      }));
  }
  /**
   * This is just an accessor to the function
   */
  createId() {
    return this.db.createId();
  }

  getallcustomers() {
    this.loaders.customers.next(true);
    this.subscriptions.set("allcustomers", this.customerService.customerCollection(this.currentOmc.value.Id)
      .where("environment", "==", this.environment.value)
      .onSnapshot(data => {
        this.loaders.customers.next(false);
        this.customers.next(this.attachId.transformArray<DaudiCustomer>(emptyDaudiCustomer, data));
      }));
  }
  /**
   *
   * @param envString
   */
  getEnvironment(envString?: Environment): QboEnvironment {
    if (!envString) {
      return this.config.value.Qbo[this.environment.value];
    } else {
      return this.config.value.Qbo[envString];
    }
  }

  /**
   *
   * @param {Depot} depot
   */
  changeactivedepot(depot: Depot) {
    if (JSON.stringify(depot) !== JSON.stringify(this.activedepot.value)) {
      const config = this.config.value.depotconfig[this.environment.value].find(t => {
        // console.log(t.depotId);
        // console.log(depot.Id);
        // console.log(t.depotId === depot.Id);
        return t.depotId === depot.Id;
      }) || { ...emptyDepotConfig };
      console.log("changing to:", depot, config.depotId, config.QbId);
      this.activedepot.next({ depot, config: { ...emptyDepotConfig, ...config } });

    }
  }
  /**
   * Unsubscribes from all subscriptions made within this service
   */
  unsubscribeAll() {
    this.subscriptions.forEach(value => {
      if (!value) { return; }
      value();
    });
  }


  /**
   * Fetches all orders and trucks Relevant to the header
   */
  getOrdersPipeline() {
    /**
     * reset the trucks and orders array when this function is invoked
     */
    this.loaders.orders.next(true);
    this.orders[1].next([]);
    this.orders[2].next([]);
    this.orders[3].next([]);
    this.orders[4].next([]);
    this.orders[5].next([]);
    this.orders[6].next([]);
    // const orderSubscription
    OrderStageIds.forEach(stage => {

      /**
       * cancel any previous queries
       */
      if (this.subscriptions.get(`orders${stage}`)) {
        this.subscriptions.get(`orders${stage}`)();
      }

      const subscriprion = this.orderService.ordersCollection(this.currentOmc.value.Id)
        .where("stage", "==", stage)
        .where("config.depot.id", "==", this.activedepot.value.depot.Id)
        .orderBy("stagedata.1.user.time", "asc")
        .onSnapshot(Data => {
          /**
           * reset the array at the postion when data changes
           */
          this.orders[stage].next([]);

          this.orders[stage].next(this.attachId.transformArray<Order>(emptyorder, Data));
          this.loaders.orders.next(false);
        });

      this.subscriptions.set(`orders${stage}`, subscriprion);
    });

    const startofweek = moment().startOf("week").toDate();
    /**
     * Fetch completed orders
     */
    const stage5subscriprion = this.orderService.ordersCollection(this.currentOmc.value.Id)
      .where("stage", "==", 5)
      .where("config.depot.id", "==", this.activedepot.value.depot.Id)
      .where("stagedata.1.user.time", "<=", startofweek)
      .orderBy("stagedata.1.user.time", "asc")
      .onSnapshot(Data => {
        /**
         * reset the array at the postion when data changes
         */
        this.orders[5].next([]);

        this.orders[5].next(this.attachId.transformArray<Order>(emptyorder, Data));
        this.loaders.orders.next(false);
      });

    this.subscriptions.set(`orders${5}`, stage5subscriprion);
  }


  fetchActiveEntries() {
    this.loaders.entries.next(true);
    this.fueltypesArray.forEach(fuelType => {
      this.subscriptions.set("entries", this.entriesService.entryCollection(this.currentOmc.value.Id)
        .where("active", "==", true)
        .where("fuelType", "==", fuelType)
        .onSnapshot(data => {
          this.loaders.entries.next(false);
          this.depotEntries[fuelType].next(this.attachId.transformArray<Entry>(emptyEntry, data));
        }));
    });
  }
}
