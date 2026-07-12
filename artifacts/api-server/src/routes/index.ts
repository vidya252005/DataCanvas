import { Router, type IRouter } from "express";
import healthRouter from "./health";
import datasetsRouter from "./datasets";

const router: IRouter = Router();

router.use(healthRouter);
router.use(datasetsRouter);

export default router;
