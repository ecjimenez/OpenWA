/**
 * Contatos do gateway do cerebro para sessões waba-relay: quem pode falar com
 * o número, em qual flow e por quanto tempo. O cadastro dispara o template de
 * abertura (regra do produto: template enviado = contato habilitado).
 */

import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { EngineRegistry } from '../../engine/engine-registry.service';
import { HubContato, WabaRelayAdapter } from '../../engine/waba-relay/waba-relay.adapter';

class CriarContatoDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{8,15}$/, { message: 'wa_id deve ser só dígitos (DDI+DDD+número)' })
  wa_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  flow?: string;

  /** 30, 60 ou null (manual). */
  @IsOptional()
  @IsIn([30, 60, null])
  periodo_dias?: number | null;

  @IsString()
  @IsNotEmpty()
  template_nome!: string;

  @IsOptional()
  @IsString()
  template_idioma?: string;

  @IsOptional()
  @IsArray()
  template_components?: unknown[];
}

class AtualizarContatoDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  flow?: string;

  @IsOptional()
  @IsIn([30, 60, null])
  periodo_dias?: number | null;
}

@Injectable()
export class WabaRelayContactsService {
  constructor(private readonly engines: EngineRegistry) {}

  adapterOf(sessionId: string): WabaRelayAdapter {
    const engine = this.engines.get(sessionId);
    if (!engine) throw new NotFoundException('Sessão não está em execução');
    if (!(engine instanceof WabaRelayAdapter)) {
      throw new BadRequestException('Contatos do gateway só existem em sessões waba-relay');
    }
    return engine;
  }
}

@ApiTags('waba-relay')
@Controller('waba-relay/sessions/:sessionId')
export class WabaRelayContactsController {
  constructor(private readonly contacts: WabaRelayContactsService) {}

  @Get('contacts')
  @ApiOperation({ summary: 'List gateway contacts (registry of who may talk to the number)' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  list(@Param('sessionId') sessionId: string): Promise<HubContato[]> {
    return this.contacts.adapterOf(sessionId).listContacts();
  }

  @Post('contacts')
  @ApiOperation({ summary: 'Register a contact — sends the opening template; sent template = enabled' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  create(@Param('sessionId') sessionId: string, @Body() dto: CriarContatoDto) {
    return this.contacts.adapterOf(sessionId).createContact(dto);
  }

  @Patch('contacts/:contactId')
  @ApiOperation({ summary: 'Update name/flow/period of a contact (new period recomputes validity)' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID' })
  update(
    @Param('sessionId') sessionId: string,
    @Param('contactId') contactId: string,
    @Body() dto: AtualizarContatoDto,
  ) {
    return this.contacts.adapterOf(sessionId).updateContact(contactId, dto);
  }

  @Delete('contacts/:contactId')
  @ApiOperation({ summary: 'Remove a contact from the gateway registry' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'contactId', description: 'Contact ID' })
  remove(@Param('sessionId') sessionId: string, @Param('contactId') contactId: string) {
    return this.contacts.adapterOf(sessionId).deleteGatewayContact(contactId);
  }
}
