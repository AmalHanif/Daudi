import { AdminLevel } from "./AdminLevel";
import { Metadata } from "../universal/Metadata";

export interface AdminType {
    name: string;
    description: string;
    levels: Array<AdminLevel>;
    metadata: Metadata;
}

export interface NewAdminType {
    level: number;
    name: string;
    description: string;
    levels: Array<AdminLevel>;
}
