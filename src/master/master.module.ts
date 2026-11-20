import { Module } from '@nestjs/common';
import { EmployeesController, ViolationsController } from './controllers.js';
import { EmployeesService } from './employees.service.js';
import { ViolationsService } from './violations.service.js';
import { MasterRepository } from './repository.js';
@Module({
  controllers: [EmployeesController, ViolationsController],
  providers: [MasterRepository, EmployeesService, ViolationsService],
})
export class MasterModule {}
