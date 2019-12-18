import { Component, OnDestroy } from "@angular/core";
import { OrdersService } from "../../../services/orders.service";
import { ReplaySubject } from "rxjs";
import { takeUntil } from "rxjs/operators"; // get our service
import { DepotService } from "../../../services/core/depot.service";
import { Depot, emptydepot } from "../../../../models/Daudi/depot/Depot";
import { OrderStageIds } from "../../../../models/Daudi/order/OrderStages";
import { TruckStageNames } from "../../../../models/Daudi/order/TruckStages";

@Component({
  selector: "my-app-sidenav-menu",
  styles: [],
  templateUrl: "./sidenav-menu.component.html"
})

export class AppSidenavMenuComponent implements OnDestroy {
  orderscount = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0
  };
  truckscount = {
    1: 0,
    2: 0,
    3: 0,
    4: 0
  };
  comopnentDestroyed: ReplaySubject<boolean> = new ReplaySubject<boolean>();
  alldepots: Array<Depot>;
  activedepot: Depot = Object.assign({}, emptydepot);

  constructor(private orderservice: OrdersService,
    private depotservice: DepotService) {
    OrderStageIds.forEach(stage => {
      this.orderservice.orders[stage].pipe(takeUntil(this.comopnentDestroyed)).subscribe(orders => this.orderscount[stage] = orders.length);
    });
    TruckStageNames.forEach(stage => {
      // this.truckservice.trucks[stage].pipe(takeUntil(this.comopnentDestroyed)).subscribe(trucks => this.truckscount[stage] = trucks.length);
    });
    this.depotservice.alldepots.pipe(takeUntil(this.comopnentDestroyed)).subscribe((alldepots: Array<Depot>) => {
      this.alldepots = alldepots;
    });
    this.depotservice.activedepot.pipe(takeUntil(this.comopnentDestroyed)).subscribe((depot) => {
      // this.activedepot = depot;
    });
  }

  ngOnDestroy(): void {
    this.comopnentDestroyed.next(true);
    this.comopnentDestroyed.complete();
  }
  changeactivedepot(depot: Depot) {
    this.depotservice.changeactivedepot(depot);

  }

}
