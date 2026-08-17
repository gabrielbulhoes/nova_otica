-- Marca de que a carga de um pedido recebido já foi repartida entre as lojas.
--
-- Acompanha a aba de distribuição (nova rodada · item 05). Enquanto o plano
-- era uma gaveta dentro da linha do pedido, disparar duas vezes exigia
-- procurar; uma aba própria põe a ação na frente de quem passa, e sem esta
-- marca a segunda visita criaria um segundo conjunto de transferências.
ALTER TABLE "PurchaseOrderRecord" ADD COLUMN "distributedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrderRecord" ADD COLUMN "distributedBy" TEXT;

-- Pedidos ANTIGOS ficam com `null` — ou seja, aparecem como "por distribuir".
--
-- É a escolha deliberada entre dois erros. Carimbá-los como distribuídos
-- esconderia da aba uma carga que talvez esteja mesmo parada na retaguarda, e
-- ninguém teria como saber; deixá-los pendentes mostra pedidos que talvez já
-- tenham sido repartidos à mão, e a operação fecha em um clique. O primeiro
-- erro é silencioso, o segundo é visível — e ainda por cima a base tem poucos
-- pedidos recebidos, então o custo é de minutos.

-- A consulta da aba: recebidos e ainda não distribuídos.
CREATE INDEX "PurchaseOrderRecord_status_distributedAt_idx"
  ON "PurchaseOrderRecord"("status", "distributedAt");
