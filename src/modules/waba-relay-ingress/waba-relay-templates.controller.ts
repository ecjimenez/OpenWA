/**
 * Meta-template routes for waba-relay sessions. Authenticated by the global
 * ApiKeyGuard like every session route — only the hub push (see the ingress
 * controller) is @Public.
 */

import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { WabaRelayTemplatesService } from './waba-relay-templates.service';

class SubmitTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  @Matches(/^[a-z0-9_]+$/, { message: 'nome só aceita minúsculas, números e underscore' })
  nome!: string;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  idioma?: string;

  @IsOptional()
  @IsIn(['UTILITY', 'MARKETING', 'AUTHENTICATION'])
  categoria?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  corpo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  rodape?: string;

  /** Valores de exemplo pras variáveis {{n}} do corpo — a Meta exige quando há variável. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  exemplo?: string[];
}

class SendTemplateDto {
  @IsString()
  @IsNotEmpty()
  chatId!: string;

  @IsString()
  @IsNotEmpty()
  nome!: string;

  @IsOptional()
  @IsString()
  idioma?: string;

  @IsOptional()
  @IsArray()
  components?: unknown[];
}

@ApiTags('waba-relay')
@Controller('waba-relay/sessions/:sessionId')
export class WabaRelayTemplatesController {
  constructor(private readonly templates: WabaRelayTemplatesService) {}

  @Get('templates')
  @ApiOperation({ summary: 'List the Meta templates of a waba-relay session (all statuses)' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  list(@Param('sessionId') sessionId: string) {
    return this.templates.listTemplates(sessionId);
  }

  @Post('templates')
  @ApiOperation({ summary: 'Submit a new template to Meta review (becomes PENDING)' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  submit(@Param('sessionId') sessionId: string, @Body() dto: SubmitTemplateDto) {
    return this.templates.submitTemplate(sessionId, dto);
  }

  @Delete('templates/:nome')
  @ApiOperation({ summary: 'Delete a Meta template by name (all language variants; irreversible)' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'nome', description: 'Template name' })
  remove(@Param('sessionId') sessionId: string, @Param('nome') nome: string) {
    return this.templates.deleteTemplate(sessionId, nome);
  }

  @Post('send-template')
  @ApiOperation({ summary: 'Send an approved Meta template (works outside the 24h window)' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  send(@Param('sessionId') sessionId: string, @Body() dto: SendTemplateDto) {
    return this.templates.sendTemplate(sessionId, dto.chatId, dto.nome, dto.idioma, dto.components);
  }
}
