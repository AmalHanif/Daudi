import { Injectable } from "@angular/core";
import { AngularFirestore } from "@angular/fire/firestore";
import * as moment from "moment";
import { BehaviorSubject, Subscription, combineLatest } from "rxjs";
import { distinctUntilChanged, skipWhile } from "rxjs/operators";
import { Depot, emptydepot } from "../../../models/Daudi/depot/Depot";
import { DepotConfig, emptyDepotConfig } from "../../../models/Daudi/depot/DepotConfig";
import { Price } from "../../../models/Daudi/depot/Price";
import { Entry } from "../../../models/Daudi/fuel/Entry";
import { FuelNamesArray, FuelType } from "../../../models/Daudi/fuel/FuelType";
import { Config, emptyConfig, QboEnvironment } from "../../../models/Daudi/omc/Config";
import { Environment } from "../../../models/Daudi/omc/Environments";
import { emptyomc, OMC } from "../../../models/Daudi/omc/OMC";
import { Order, emptyorder } from "../../../models/Daudi/order/Order";
import { OrderStageIds, OrderStages } from "../../../models/Daudi/order/OrderStages";
import { OrdersService } from "../orders.service";
import { AdminService } from "./admin.service";
import { ConfigService } from "./config.service";
import { DepotService } from "./depot.service";
import { OmcService } from "./omc.service";
import { DaudiCustomer } from "../../../models/Daudi/customer/Customer";
import { AttachId } from "../../../shared/pipes/attach-id.pipe";
import { CustomerService } from "../customers.service";
import { emptyDaudiCustomer } from "../../../models/Daudi/customer/Customer";

@Injectable({
  providedIn: "root"
})
/**
 * This singleton keeps all the variables needed by the app to run and automatically keeps and manages the subscriptions
 */
export class CoreService {
  omcconfig: BehaviorSubject<Config> = new BehaviorSubject<Config>({ ...emptyConfig });
  environment: BehaviorSubject<Environment> = new BehaviorSubject<Environment>(Environment.sandbox);
  alldepots: BehaviorSubject<Array<Depot>> = new BehaviorSubject([]);
  allcustomers: BehaviorSubject<Array<DaudiCustomer>> = new BehaviorSubject<Array<DaudiCustomer>>([]);
  loadingcustomers: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(true);

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

  fetchingEntry = new BehaviorSubject(true);
  depotEntries: {
    pms: BehaviorSubject<Array<Entry>>,
    ago: BehaviorSubject<Array<Entry>>,
    ik: BehaviorSubject<Array<Entry>>,
  } = {
      pms: new BehaviorSubject([]),
      ago: new BehaviorSubject([]),
      ik: new BehaviorSubject([])
    };

  avgprices: {
    [key in FuelType]: {
      total: BehaviorSubject<number>,
      avg: BehaviorSubject<number>,
      prices: BehaviorSubject<Array<Price>>
    }
  } = {
      pms: {
        total: new BehaviorSubject<number>(0),
        avg: new BehaviorSubject<number>(0),
        prices: new BehaviorSubject<Array<Price>>([])
      },
      ago: {
        total: new BehaviorSubject<number>(0),
        avg: new BehaviorSubject<number>(0),
        prices: new BehaviorSubject<Array<Price>>([])
      },
      ik: {
        total: new BehaviorSubject<number>(0),
        avg: new BehaviorSubject<number>(0),
        prices: new BehaviorSubject<Array<Price>>([])
      }
    };
  fueltypesArray = FuelNamesArray;
  loadingorders = new BehaviorSubject(true);
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
    private adminservice: AdminService) {
    this.adminservice.observableuserdata
      .subscribe(admin => {
        if (admin) {
          this.subscriptions.set("configSubscription", this.configService.configCollection(admin)
            .onSnapshot(t => this.omcconfig.next(this.attachId.transformObject<Config>(emptyConfig, t))));
        }
      });

    /**
     * fetch the pipeline every time the depot changes
     */
    combineLatest([this.activedepot.pipe(skipWhile(t => !t.depot.Id)),
    this.currentOmc.pipe(skipWhile(t => !t.Id))]).subscribe(() => {
      this.getOrdersPipeline();
    });
    /**
     * Only subscribe to depot when the user data changes
     */
    this.adminservice.observableuserdata
      .pipe(distinctUntilChanged())
      .subscribe(admin => {
        if (admin) {
          this.unsubscribeAll();
          this.subscriptions.set("alldepots", this.depotService
            .depotsCollection()
            .where("Active", "==", true)
            .orderBy("Name", "asc")
            .onSnapshot((data) => {
              this.alldepots.next(this.attachId.transformArray<Depot>(emptydepot, data));
              const tempdepot: Depot = this.alldepots.value[0];
              if (this.alldepots.value.find(depot => depot.Id === this.activedepot.value.depot.Id)) {
                this.changeactivedepot(this.alldepots.value.find(depot => depot.Id === this.activedepot.value.depot.Id));
              } else {
                this.changeactivedepot(tempdepot);
              }

              /**
               * only get OMC's when a valid depot has been assigned
               * only take the first element, OMC's are not dependent on depot
               */

              this.getOmcs();
            })
          );
        }
      });
  }
  getOmcs() {
    this.subscriptions.set("allomcs", this.omc.omcCollection()
      .orderBy("name", "asc")
      .onSnapshot(data => {
        this.omcs.next(this.attachId.transformArray<OMC>(emptyomc, data));
        this.omcs.value.forEach(co => {
          if (co.Id === this.adminservice.userdata.config.omcId) {
            /**
             * Only make the pipeline subscription once
             */
            if (this.currentOmc.value.Id !== this.adminservice.userdata.config.omcId) {
              this.currentOmc.next(co);

              this.getallcustomers();
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
    this.loadingcustomers.next(true);
    this.subscriptions.set("allcustomers", this.customerService.customerCollection(this.currentOmc.value.Id)
      .where("environment", "==", this.environment.value)
      .onSnapshot(data => {
        this.loadingcustomers.next(false);
        this.allcustomers.next(this.attachId.transformArray<DaudiCustomer>(emptyDaudiCustomer, data));
      }));
  }
  /**
   *
   * @param envString
   */
  getEnvironment(envString?: Environment): QboEnvironment {
    if (!envString) {
      return this.omcconfig.value.Qbo[this.environment.value];
    } else {
      return this.omcconfig.value.Qbo[envString];
    }
  }

  /**
   *
   * @param {Depot} depot
   */
  changeactivedepot(depot: Depot) {
    if (JSON.stringify(depot) !== JSON.stringify(this.activedepot.value)) {
      const config = this.omcconfig.value.depotconfig[this.environment.value].find(t => {
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
      // value();
    });
  }


  /**
   * Fetches all orders and trucks Relevant to the header
   */
  getOrdersPipeline() {
    /**
     * reset the trucks and orders array when this function is invoked
     */
    this.loadingorders.next(true);
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
          this.loadingorders.next(false);
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
      .orderBy("stagedata.1.user.time", "asc")
      .onSnapshot(Data => {
        /**
         * reset the array at the postion when data changes
         */
        this.orders[5].next([]);

        this.orders[5].next(this.attachId.transformArray<Order>(emptyorder, Data));
        this.loadingorders.next(false);
      });

    this.subscriptions.set(`orders${5}`, stage5subscriprion);
  }
}
